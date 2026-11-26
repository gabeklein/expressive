// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotFound, Redirect, client } from "@expressive/rpc";
import { Component, Context, Model, set } from "@expressive/mvc";
import { accept } from "@expressive/mvc/hot";
import { NavLinks, Redirect as RouterRedirect } from "@expressive/router";

import { browserRouter, location, mount, settle } from "../../test.setup";
import { Route } from "./route";
import { Router } from "./router";

afterEach(() => vi.unstubAllGlobals());

it("will reject a caught error during server rendering", async () => {
  const route = Route.new();
  const error = new Error("server");
  vi.stubGlobal("window", undefined);

  await expect(route.catch(error)).rejects.toBe(error);
  route.set(null);
});

it.each([new Redirect("/other"), new RouterRedirect("/other")])("will follow a %s during server rendering", async error => {
  const router = Router.new(Context.root);
  const route = Route.new();
  vi.stubGlobal("window", undefined);
  await route.catch(error);
  expect(router.path).toBe("/other");
  vi.unstubAllGlobals();
  route.set(null);
  router.set(null);
});

it("will release a prebuilt default without a browser window", async () => {
  const router = Router.new(Context.root);
  const gone = vi.fn();
  class Guard extends Model { protected new() { return gone; } }
  const route = Route.new({ enter: () => Guard });
  vi.stubGlobal("window", undefined);
  await (route.redirect as () => Promise<unknown>)();
  route.set(null);
  expect(gone).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
  router.set(null);
});

it("will leave non-setup and unowned setup reports for other handlers", async () => {
  const seen: string[] = [];
  const stop = Model.on({ catch(_error, kind) { seen.push(kind); } });
  const router = Router.new(Context.root);
  class Task extends Model {
    value = 0;
    protected async new() { throw new NotFound("missing"); }
  }
  const task = Task.new();
  await settle();
  task.set(null);
  task.value = 1;
  expect(seen).toContain("setup");
  expect(seen).toContain("dead");
  router.set(null);
  stop();
});

describe("browser errors", () => {
  const router = browserRouter() as unknown as { current: { path: string; set(key: "path"): unknown } };

  it("will keep a caught error on the same path and ignore a second retry", async () => {
    let retry: (() => void) | undefined;
    const Catch = ({ retry: again }: { retry: () => void }) => {
      retry = again;
      return <p>caught</p>;
    };
    location("/broken");
    const root = await mount(() => <Route Catch={Catch}><Route to="broken" as={() => { throw new Error("broken"); }} /></Route>);

    expect(root.textContent).toBe("caught");
    router.current.set("path");
    await settle();
    expect(root.textContent).toBe("caught");
    retry!();
    retry!();
    await settle();
  });

  it("will show Catch for a non-http redirect without navigating", async () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    const root = await mount(() => <Route Catch={() => <p>caught</p>}><Route as={() => { throw new Redirect("javascript:alert(1)"); }} /></Route>);
    expect(root.textContent).toBe("caught");
    expect(assign).not.toHaveBeenCalled();
  });

  it("will show Catch for an invalid redirect URL", async () => {
    const root = await mount(() => <Route Catch={() => <p>caught</p>}><Route as={() => { throw new Redirect("http://["); }} /></Route>);
    expect(root.textContent).toBe("caught");
  });

  it("will assign an external redirect and an unserved local path", async () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    const root = await mount(() => <Route Catch={() => <p>caught</p>}><Route as={() => { throw new Redirect("/api/auth/start"); }} /></Route>);
    expect(assign).toHaveBeenCalledWith(new URL("/api/auth/start", window.location.href).href);
    expect(root.textContent).toBe("");
    const external = await mount(() => <Route Catch={() => <p>caught</p>}><Route as={() => { throw new Redirect("https://auth.example.com/login"); }} /></Route>);
    expect(assign).toHaveBeenLastCalledWith("https://auth.example.com/login");
    expect(external.textContent).toBe("");
  });

  it("will skip a missing-path route when resolving a redirect target", async () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    const root = await mount(() => <Route Catch={() => <p>caught</p>}><Route as={() => { throw new Redirect("/lost"); }} /><Route none as={() => <p>missing</p>} /></Route>);
    expect(assign).toHaveBeenCalledWith(new URL("/lost", window.location.href).href);
    expect(root.textContent).toBe("");
  });

  it("will find a redirect target below a non-route wrapper", async () => {
    const root = await mount(() => <Route><><Route as={() => { throw new Redirect("/served"); }} /><Route to="served" as={() => <p>served</p>} /></></Route>);
    await settle();
    expect(root.textContent).toBe("served");
  });

  it("will release the path listener when a caught route is destroyed", async () => {
    let route!: Route;
    location("/");
    await mount(() => <Route Catch={() => <p>caught</p>}><Route as={() => { route = Route.get().parent as Route; return <p>ready</p>; }} /></Route>);
    let resolved = false;
    const pending = route.catch(new Error("broken")).then(() => { resolved = true; });
    route.set(null);
    router.current.path = "/other";
    await settle();
    expect(resolved).toBe(false);
    void pending;
  });

  it("will keep a caught route pending when the path is set to the same value", async () => {
    let route!: Route;
    location("/");
    await mount(() => <Route Catch={() => <p>caught</p>}><Route as={() => { route = Route.get().parent as Route; return <p>ready</p>; }} /></Route>);
    let resolved = false;
    const pending = route.catch(new Error("broken")).then(() => { resolved = true; });
    await settle();
    router.current.set("path");
    await settle();
    expect(resolved).toBe(false);
    route.set(null);
    void pending;
  });
});

describe("prebuilt defaults", () => {
  let router: Router;
  let logged: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    router = Router.new(Context.root);
    logged = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
    router.set(null);
  });

  it("will await new before rendering and provide the instance below", async () => {
    let release!: () => void;
    const order: string[] = [];
    class Session extends Model {
      name = "ada";
      protected async new() {
        order.push("new");
        await new Promise<void>(resolve => (release = resolve));
        order.push("ready");
      }
    }
    const Page = () => {
      order.push("render");
      return <p>{Session.get().name}</p>;
    };
    location("/");
    const root = await mount(() => <Route enter={() => Session} fallback={null}><Route as={Page} /></Route>);
    expect(root.textContent).toBe("");
    expect(order).toEqual(["new"]);
    release();
    await vi.waitFor(() => expect(root.textContent).toBe("ada"));
    expect(order).toEqual(["new", "ready", "render"]);
  });

  it("will replace a default after a param change without leaving two in context", async () => {
    const gone = vi.fn();
    let built = 0;
    class Guard extends Model { protected new() { built++; return gone; } }
    location("/note/1");
    const root = await mount(() => <Route><Route to="note/:id" enter={() => Guard}><Route as={() => <p>{Guard.get().is.toString() && "ready"}</p>} /></Route></Route>);
    await vi.waitFor(() => expect(root.textContent).toBe("ready"));
    router.goto("/note/2");
    await vi.waitFor(() => expect(built).toBe(2));
    expect(root.textContent).toBe("ready");
    expect(gone).toHaveBeenCalledOnce();
  });

  it("will discard a build abandoned for another route", async () => {
    const releases: Array<() => void> = [];
    let current!: Guard;
    class Guard extends Model {
      protected async new() { current = this; await new Promise<void>(resolve => releases.push(resolve)); }
    }
    location("/");
    const root = await mount(() => <Route><Route as={() => <p>home</p>} /><Route to="a" enter={() => Guard}><Route as={() => <p>a</p>} /></Route><Route to="b" as={() => <p>b</p>} /></Route>);
    router.goto("/a");
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    router.goto("/b");
    await vi.waitFor(() => expect(root.textContent).toBe("b"));
    releases[0]();
    await vi.waitFor(() => expect(current.get(null)).toBe(true));
    router.goto("/a");
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]();
    await vi.waitFor(() => expect(root.textContent).toBe("a"));
  });

  it.each([new Redirect("/signin"), new NotFound("missing")])("will ignore a late %s from an abandoned default", async error => {
    let reject!: (error: Error) => void;
    class Guard extends Model { protected new() { return new Promise<void>((_, fail) => (reject = fail)); } }
    location("/");
    const root = await mount(() => <Route><Route as={() => <p>home</p>} /><Route to="a" enter={() => Guard}><Route as={() => <p>a</p>} /></Route><Route to="b" as={() => <p>b</p>} /><Route to="signin" as={() => <p>signin</p>} /></Route>);
    router.goto("/a");
    await vi.waitFor(() => expect(reject).toBeTypeOf("function"));
    router.goto("/b");
    await vi.waitFor(() => expect(root.textContent).toBe("b"));
    reject(error);
    await settle();
    expect(root.textContent).toBe("b");
  });

  it("will mount nested routes under an unmatched folder and list them", async () => {
    let child!: Route;
    class Child extends Route { protected new() { child = this; } }
    location("/c");
    const root = await mount(() => <Route><NavLinks /><Route to="a" label="A"><Child to="b" label="B" as={() => <p>b</p>} /></Route><Route to="c" as={() => <p>c</p>} /></Route>);
    await vi.waitFor(() => expect(child).toBeDefined());
    expect(root.textContent).toContain("B");
  });

  it("will hold the current screen while a new default awaits", async () => {
    let release!: () => void;
    class Guard extends Model {
      protected async new() { await new Promise<void>(resolve => (release = resolve)); }
    }
    location("/");
    const root = await mount(() => <Route><Route as={() => <p>home</p>} /><Route to="next" enter={() => Guard}><Route as={() => <p>next</p>} /></Route></Route>);
    router.goto("/next");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(root.textContent).toBe("home");
    release();
    await vi.waitFor(() => expect(root.textContent).toBe("next"));
  });

  it("will keep the leaving default live during a held navigation", async () => {
    let release!: () => void;
    let current!: Guard;
    class Guard extends Model { count = 0; protected new() { current = this; } }
    class Slow extends Model { protected new() { return new Promise<void>(done => (release = done)); } }
    location("/a");
    const root = await mount(() => <Route><Route to="a" enter={() => Guard}><Route as={() => <p>{Guard.get().count}</p>} /></Route><Route to="b" enter={() => Slow}><Route as={() => <p>b</p>} /></Route></Route>);
    await vi.waitFor(() => expect(root.textContent).toBe("0"));
    router.goto("/b");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    current.count = 1;
    await vi.waitFor(() => expect(root.textContent).toBe("1"));
    release();
    await vi.waitFor(() => expect(root.textContent).toBe("b"));
    expect(current.get(null)).toBe(true);
  });

  it("will render a prebuilt Component around its page and destroy it on leave", async () => {
    const gone = vi.fn();
    class Frame extends Component {
      protected new() { return gone; }
      render(props: { children?: Component.Node }) { return <section>{props.children}</section>; }
    }
    location("/x");
    const root = await mount(() => <Route><Route to="x" enter={() => Frame}><Route as={() => <p>inside</p>} /></Route><Route to="y" as={() => <p>other</p>} /></Route>);
    await vi.waitFor(() => expect(root.textContent).toBe("inside"));
    window.history.pushState(null, "", "/y");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.waitFor(() => expect(root.textContent).toBe("other"));
    expect(gone).toHaveBeenCalledOnce();
  });

  it.each([false, true])("will keep %s new errors out of render", async asyncNew => {
    const page = vi.fn(() => <p>page</p>);
    class Guard extends Model {
      protected new() {
        if (asyncNew) return Promise.reject(new NotFound("missing"));
        throw new NotFound("missing");
      }
    }
    location("/x");
    const root = await mount(() => <Route Catch={({ error }) => <p>{error.message}</p>}><Route to="x" enter={() => Guard}><Route as={page} /></Route></Route>);
    await vi.waitFor(() => expect(root.textContent).toBe("missing"));
    expect(page).not.toHaveBeenCalled();
  });

  it.each([false, true])("will redirect from %s new before rendering", async asyncNew => {
    const page = vi.fn(() => <p>guarded</p>);
    class Guard extends Model {
      protected new() {
        if (asyncNew) return Promise.reject(new Redirect("/allowed"));
        throw new Redirect("/allowed");
      }
    }
    location("/guarded");
    const root = await mount(() => <Route><Route to="guarded" enter={() => Guard}><Route as={page} /></Route><Route to="allowed" as={() => <p>allowed</p>} /></Route>);
    await vi.waitFor(() => expect(root.textContent).toBe("allowed"));
    expect(page).not.toHaveBeenCalled();
  });

  it("will handle a built default's rejection only through its guard", async () => {
    let caught = 0;
    class Guard extends Model { protected async new() { throw new Redirect("/allowed"); } }
    class Scoped extends Route {
      catch(error: Error) { caught++; return super.catch(error); }
    }
    location("/guarded");
    const root = await mount(() => <Route><Scoped to="guarded" enter={() => Guard}><Route as={() => <p>guarded</p>} /></Scoped><Route to="allowed" as={() => <p>allowed</p>} /></Route>);
    await vi.waitFor(() => expect(root.textContent).toBe("allowed"));
    expect(caught).toBe(0);
  });

  it("will build in the entering path before the current path changes", async () => {
    let entered: unknown;
    let current: unknown;
    class Guard extends Model {
      protected new() {
        const path = (globalThis as Record<symbol, unknown>)[Symbol.for("@expressive/dev#path")];
        entered = client().pathOf(["note", ":id"], "served", path as string);
        current = window.location.pathname;
      }
    }
    location("/");
    const root = await mount(() => <Route><Route as={() => <p>home</p>} /><Route to="note/:id" enter={() => Guard}><Route as={() => <p>next</p>} /></Route></Route>);
    router.goto("/note/8");
    await vi.waitFor(() => expect(root.textContent).toBe("next"));
    expect(entered).toBe("/note/8");
    expect(current).toBe("/");
  });

  it("will wait for a required factory before rendering", async () => {
    let release!: (value: string) => void;
    class Guard extends Model {
      value = set(() => new Promise<string>(resolve => (release = resolve)), true);
    }
    const page = vi.fn(() => <p>{Guard.get().value}</p>);
    location("/");
    const root = await mount(() => <Route enter={() => Guard}><Route as={page} /></Route>);
    expect(page).not.toHaveBeenCalled();
    release("ready");
    await vi.waitFor(() => expect(root.textContent).toBe("ready"));
  });

  it("will rebuild a default after its new method changes", async () => {
    let built = 0;
    const gone = vi.fn();
    class Guard extends Model {
      protected new() { built++; return gone; }
    }
    const entry = Object.assign(() => Guard, { source: "app/guard.tsx" });
    location("/");
    const root = await mount(() => <Route enter={entry}><Route as={() => <p>ready</p>} /></Route>);
    await vi.waitFor(() => expect(root.textContent).toBe("ready"));
    expect(built).toBe(1);
    accept("dev-route-default", { Guard });
    accept("dev-route-default", { Guard: class Guard extends Model {
      protected new() { built += 1; return gone; }
    } });
    window.dispatchEvent(new Event("expressive:route-update"));
    window.dispatchEvent(new CustomEvent("expressive:route-update", { detail: ["/app/other.tsx"] }));
    window.dispatchEvent(new CustomEvent("expressive:route-update", { detail: ["/xapp/guard.tsx"] }));
    expect(built).toBe(1);
    window.dispatchEvent(new CustomEvent("expressive:route-update", { detail: ["/app/guard.tsx"] }));
    await vi.waitFor(() => expect(built).toBe(2));
    expect(gone).toHaveBeenCalledOnce();
  });

  it("will keep a default when render or Page changes in its source module", async () => {
    let built = 0;
    const gone = vi.fn();
    const version = (tag: string) => class Guard extends Component {
      value = 4;
      protected new() { built++; return gone; }
      render(props: { children?: Component.Node }) { return <section data-tag={tag}>{props.children}</section>; }
    };
    const Guard = accept("dev-route-render", { Guard: version("old") }).Guard;
    const entry = Object.assign(() => Guard, { source: "app/guard.tsx" });
    location("/");
    const root = await mount(() => <Route enter={entry}><Route as={() => <p>{Guard.get().value}</p>} /></Route>);
    await vi.waitFor(() => expect(root.textContent).toBe("4"));
    expect(gone).not.toHaveBeenCalled();
    accept("dev-route-render", { Guard: version("new") });
    window.dispatchEvent(new CustomEvent("expressive:route-update", { detail: ["/app/guard.tsx"] }));
    expect(built).toBe(1);
    expect(gone).not.toHaveBeenCalled();
    expect(root.textContent).toBe("4");
    await vi.waitFor(() => expect(root.querySelector("section")?.getAttribute("data-tag")).toBe("new"));
  });

  it("will rebuild when hot replacement retires the default class", async () => {
    let built = 0;
    class Guard extends Model { value = 1; protected new() { built++; } }
    accept("dev-route-fields", { Guard });
    let Current: Model.Extends = Guard;
    const entry = Object.assign(() => Current, { source: "app/guard.tsx", current: () => Current });
    location("/");
    const root = await mount(() => <Route enter={entry}><Route as={() => <p>ready</p>} /></Route>);
    await vi.waitFor(() => expect(root.textContent).toBe("ready"));
    Current = accept("dev-route-fields", { Guard: class Guard extends Model {
      value = 2;
      extra = true;
      protected new() { built++; }
    } }).Guard;
    window.dispatchEvent(new CustomEvent("expressive:route-update", { detail: ["/app/guard.tsx"] }));
    await vi.waitFor(() => expect(built).toBe(2));
    expect(root.textContent).toBe("ready");
  });

  it("will keep one destroy registration across three builds", async () => {
    let active = 0;
    class Guard extends Model {}
    const route = Route.new();
    const original = route.set.bind(route);
    vi.spyOn(route, "set").mockImplementation(((status: unknown, callback?: () => void) => {
      const result = (original as (...args: unknown[]) => unknown)(status, callback);
      if (status !== null || callback?.name !== "dispose") return result;
      active++;
      return () => { active--; return (result as () => boolean)(); };
    }) as typeof route.set);
    route.enter = () => Guard;
    for (let i = 0; i < 3; i++) {
      await (route.redirect as () => Promise<unknown>)();
      expect(active).toBe(1);
    }
    route.set(null);
    expect(active).toBe(0);
  });

  it("will keep a default when an unrelated hot update arrives", async () => {
    const gone = vi.fn();
    class Guard extends Model { protected new() { return gone; } }
    location("/");
    await mount(() => <Route enter={() => Guard}><Route as={() => <p>ready</p>} /></Route>);
    window.dispatchEvent(new CustomEvent("expressive:route-update", { detail: ["/app/guard.tsx"] }));
    expect(gone).not.toHaveBeenCalled();
  });

  it("will keep a default when navigating inside its route", async () => {
    const gone = vi.fn();
    class Guard extends Model { protected new() { return gone; } }
    location("/x");
    const root = await mount(() => <Route enter={() => Guard}><Route to="x" as={() => <p>x</p>} /><Route to="y" as={() => <p>y</p>} /></Route>);
    router.goto("/y");
    await vi.waitFor(() => expect(root.textContent).toBe("y"));
    expect(gone).not.toHaveBeenCalled();
  });

  it("will retry a caught route after a hot update", async () => {
    let broken = true;
    const Page = () => {
      if (broken) throw new Error("broken");
      return <p>fixed</p>;
    };
    location("/");
    const root = await mount(() => <Route Catch={() => <p>caught</p>}><Route as={Page} /></Route>);
    expect(root.textContent).toBe("caught");
    broken = false;
    window.dispatchEvent(new Event("expressive:route-update"));
    await vi.waitFor(() => expect(root.textContent).toBe("fixed"));
  });
});

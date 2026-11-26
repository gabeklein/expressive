// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { NotFound, Redirect } from "@expressive/rpc";
import { Context, Model } from "@expressive/mvc";
import { Redirect as RouterRedirect } from "@expressive/router";

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

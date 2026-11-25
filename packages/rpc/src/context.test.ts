import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Context, get, set, Model } from "@expressive/mvc";

import { bind, construct, Current, headersOf, install, layer, onBuild, seated, within, type Gate, type Seat } from "./context";
import { Cookies } from "./cookies";
import { Forbidden, Redirect } from "./errors";

const request = (url = "/", cookie = "") => new Request(`http://localhost${url}`, { headers: { cookie } });
const call = <T>(segments: string[], run: () => T) => within(request("/" + segments.join("/")), segments, run);

beforeAll(() => install());
afterEach(() => vi.useRealTimers());

const walk = <T>(req: Request, segments: string[], seats: (Seat | Gate | undefined)[], run: () => T) => within(req, segments, run, seats);

describe("server get", () => {
  it("will leave a bare context lookup outside a call to the host", async () => {
    expect(Context.get()).toBe(Context.root);
    expect(await call(["bare"], () => Context.get())).not.toBe(Context.root);
  });

  it("will throw outside a call", () => {
    class Tally extends Model {}
    expect(() => Tally.get()).toThrow("Server Model resolves only within a request.");
  });

  it("will find what context provides, or throw if missing unless optional", async () => {
    class Missing extends Model {}

    await call([], () => {
      expect(Current.get()).toBeInstanceOf(Current);
      expect(Missing.get(false)).toBeUndefined();
      expect(() => Missing.get()).toThrow("Could not find");
    });
  });
});

describe("seats", () => {
  const as = (user: string) => request("/", `user=${user}`);

  it("will seat a layer's default as a call walks through it, found by get() there and below", async () => {
    class Blog extends Model { static ttl = 60; }

    const here = await walk(request(), ["blog"], [undefined, Blog], () => Blog.get());
    const below = await walk(request(), ["blog", "a"], [undefined, Blog], () => Blog.get());

    expect(below).toBe(here);
    await expect(walk(request(), ["docs"], [], () => Blog.get())).rejects.toThrow("Could not find Blog in context.");
  });

  it("will drop a seat after its last call by default", async () => {
    class Tally extends Model {}

    const first = await walk(request(), ["tally"], [undefined, Tally], () => Tally.get());

    expect(first.get(null)).toBe(true);
    expect(await walk(request(), ["tally"], [undefined, Tally], () => Tally.get())).not.toBe(first);
  });

  it("will keep a seat after its last call for the ttl install() names", async () => {
    vi.useFakeTimers();
    install({ ttl: 300 });
    class Tally extends Model {}

    try {
      const first = await walk(request(), ["tally"], [undefined, Tally], () => Tally.get());

      vi.advanceTimersByTime(299_000);
      expect(await walk(request(), ["tally"], [undefined, Tally], () => Tally.get())).toBe(first);

      vi.advanceTimersByTime(300_000);
      expect(first.get(null)).toBe(true);
      expect(await walk(request(), ["tally"], [undefined, Tally], () => Tally.get())).not.toBe(first);
    } finally {
      install();
    }
  });

  it("will keep a seat between calls for its ttl", async () => {
    vi.useFakeTimers();
    class Tally extends Model { static ttl = 60; }

    const first = await walk(request(), ["tally"], [undefined, Tally], () => Tally.get());
    expect(await walk(request(), ["tally"], [undefined, Tally], () => Tally.get())).toBe(first);

    vi.advanceTimersByTime(60_000);
    expect(first.get(null)).toBe(true);
    expect(await walk(request(), ["tally"], [undefined, Tally], () => Tally.get())).not.toBe(first);
  });

  it("will drop a seat after its call with a ttl of zero", async () => {
    class Tally extends Model { static ttl = 0; }

    const first = await walk(request(), ["tally"], [undefined, Tally], () => Tally.get());

    expect(first.get(null)).toBe(true);
    expect(await walk(request(), ["tally"], [undefined, Tally], () => Tally.get())).not.toBe(first);
  });

  it("will keep a seat while another call holds it", async () => {
    class Tally extends Model { static ttl = 0; }
    let finish!: () => void;
    const open = new Promise<void>(resolve => (finish = resolve));

    const held = walk(request(), ["tally"], [undefined, Tally], async () => {
      await open;
      return Tally.get();
    });
    const quick = await walk(request(), ["tally"], [undefined, Tally], () => Tally.get());

    expect(quick.get(null)).toBe(false);
    finish();
    expect(await held).toBe(quick);
    expect(quick.get(null)).toBe(true);
  });

  it("will replace a seat whose class changed, evicting the layers below", async () => {
    class Before extends Model { static ttl = 60; }
    class After extends Model { static ttl = 60; }
    class Post extends Model { static ttl = 60; }

    const [before, post] = await walk(request(), ["blog", "a"], [undefined, Before, Post], () => [Before.get(), Post.get()]);
    const after = await walk(request(), ["blog"], [undefined, After], () => After.get());

    expect(before.get(null)).toBe(true);
    expect(post.get(null)).toBe(true);
    expect(after).toBeInstanceOf(After);
    expect(await walk(request(), ["blog", "a"], [undefined, After, Post], () => Post.get())).not.toBe(post);
  });

  it("will give each layer its own seat, a deeper one over one above", async () => {
    class Page extends Model { static ttl = 60; }

    const above = await walk(request(), ["blog"], [undefined, Page], () => Page.get());
    const a = await walk(request(), ["blog", "a"], [undefined, Page, Page], () => Page.get());
    const b = await walk(request(), ["blog", "b"], [undefined, Page, Page], () => Page.get());

    expect(a).not.toBe(above);
    expect(b).not.toBe(a);
    expect(await walk(request(), ["blog", "a", "x"], [undefined, Page, Page], () => Page.get())).toBe(a);
    expect(await walk(request(), ["blog", "c"], [undefined, Page], () => Page.get())).toBe(above);
  });

  it("will resolve fields from the context the seat lives in", async () => {
    class Tally extends Model { current = get(Current); }

    const url = await walk(request("/tally"), ["tally"], [undefined, Tally], () => Tally.get().current.url.pathname);
    expect(url).toBe("/tally");
  });

  it("will provide a seat's children there and below, a lazy one once its owner reads it", async () => {
    class Total extends Model { value = 0; }
    class Draft extends Model {}
    class Tally extends Model {
      static ttl = 60;
      total = new Total();
      draft = set(() => new Draft());
    }

    const [tally, total] = await walk(request(), ["tally"], [undefined, Tally], () => [Tally.get(), Total.get()] as const);

    expect(total).toBe(tally.total);
    expect(await walk(request(), ["tally", "x"], [undefined, Tally], () => Total.get())).toBe(total);

    await expect(walk(request(), ["tally"], [undefined, Tally], () => Draft.get())).rejects.toThrow("Could not find Draft in context.");

    const draft = await walk(request(), ["tally"], [undefined, Tally], () => Tally.get().draft);
    expect(await walk(request(), ["tally"], [undefined, Tally], () => Draft.get())).toBe(draft);

    tally.set(null);
    expect(total.get(null)).toBe(true);
    expect(draft.get(null)).toBe(true);
  });

  it("will narrow everything below by a seat's key", async () => {
    class Session extends Model { static key() { return Current.get().cookies.user; } }
    class Cart extends Model {}

    const a = await walk(as("a"), ["shop"], [Session, Cart], () => [Session.get(), Cart.get()]);
    const b = await walk(as("b"), ["shop"], [Session, Cart], () => [Session.get(), Cart.get()]);

    expect(b[0]).not.toBe(a[0]);
    expect(b[1]).not.toBe(a[1]);
    expect(await walk(as("a"), ["shop"], [Session, Cart], () => [Session.get(), Cart.get()])).toEqual(a);
  });

  it("will pass the location through when a key is undefined", async () => {
    class Shared extends Model { static ttl = 60; static key() { return undefined; } }

    const a = await walk(as("a"), ["docs"], [undefined, Shared], () => Shared.get());
    expect(await walk(as("b"), ["docs"], [undefined, Shared], () => Shared.get())).toBe(a);
  });

  it("will run a key with the seats above it in reach", async () => {
    class Session extends Model { static key() { return Current.get().cookies.user; } org = "acme"; }
    class Org extends Model { static key() { return Session.get().org; } }

    const org = await walk(as("a"), ["org"], [Session, Org], () => Org.get());
    expect(org).toBeInstanceOf(Org);
  });

  it("will deny a call whose key throws, creating nothing", async () => {
    class Gate extends Model { static key(): string { throw new Error("Denied"); } }
    const run = vi.fn();

    await expect(walk(request(), ["gate"], [undefined, Gate], run)).rejects.toThrow("Denied");
    expect(run).not.toHaveBeenCalled();
  });

  it("will wait for a new seat's async new() before the layers below and the call", async () => {
    let done!: () => void;
    class Session extends Model {
      user?: string = undefined;

      protected async new() {
        await new Promise<void>(resolve => (done = resolve));
        this.user = "ada";
      }
    }
    class Account extends Model { static key() { return Session.get().user; } }

    const ran = vi.fn(() => Session.get().user);
    const first = walk(request(), ["account"], [Session, Account], ran);
    const second = walk(request(), ["account"], [Session, Account], ran);

    await new Promise(resolve => setTimeout(resolve));
    expect(ran).not.toHaveBeenCalled();

    done();
    expect(await first).toBe("ada");
    expect(await second).toBe("ada");
  });

  it("will deny the calls walking through a seat whose async new() rejects, unreported, and build afresh after", async () => {
    let attempt = 0;
    class Denied extends Error { status = 403; }
    class Gate extends Model {
      protected async new() {
        if (!attempt++) throw new Denied("Not yours");
      }
    }
    const run = vi.fn();
    const failed = vi.fn();

    process.on("uncaughtException", failed);

    try {
      const walks = [walk(request(), ["gate"], [undefined, Gate], run), walk(request(), ["gate"], [undefined, Gate], run)];

      for (const denied of walks) await expect(denied).rejects.toBeInstanceOf(Denied);
      expect(run).not.toHaveBeenCalled();

      await walk(request(), ["gate"], [undefined, Gate], run);
      await new Promise(resolve => setTimeout(resolve));
    } finally {
      process.off("uncaughtException", failed);
    }

    expect(run).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it("will report a seat's other errors as usual", async () => {
    class Tally extends Model {
      static ttl = 60;
      total = 0;
    }
    const caught = vi.fn();
    const stop = Model.on({ catch: (_error, kind) => void caught(kind) });

    try {
      const tally = await walk(request(), ["tally"], [undefined, Tally], () => Tally.get());

      tally.get(({ total }) => {
        if (total) throw new Error("effect");
      });
      tally.total = 1;
      await new Promise(resolve => setTimeout(resolve));
    } finally {
      stop();
    }

    expect(caught).toHaveBeenCalledWith("effect");
  });

  it("will throw if a key is not a string, a number or undefined", async () => {
    class Bad extends Model { static key() { return {} as any; } }

    await expect(walk(request(), ["bad"], [undefined, Bad], () => {})).rejects.toThrow("Bad.key() returned [object Object] - a key is a string, a number or undefined.");
  });

  it("will evict a seat's layer and everything below when it ends", async () => {
    class Blog extends Model {}
    class Post extends Model { static ttl = 60; }

    const [blog, post] = await walk(request(), ["blog", "a"], [undefined, Blog, Post], () => [Blog.get(), Post.get()]);
    blog.set(null);

    expect(post.get(null)).toBe(true);

    const [again, fresh] = await walk(request(), ["blog", "a"], [undefined, Blog, Post], () => [Blog.get(), Post.get()]);
    expect(again).not.toBe(blog);
    expect(fresh).not.toBe(post);
  });

  it("will evict the unseated layers below a seat that ends", async () => {
    class Shop extends Model {}
    class Cart extends Model {}

    const [shop, cart] = await walk(request(), ["shop", "a"], [undefined, Shop], () => [Shop.get(), construct(Cart)] as const);
    shop.set(null);

    expect(cart.instance.get(null)).toBe(true);
  });
});

describe("gates", () => {
  const tick = () => new Promise(resolve => setTimeout(resolve));

  class Denied extends Error { status = 401; }

  it("will run a function gate per call, its Models found by get() in the call and gone after", async () => {
    class Session extends Model { user = "ada"; }
    const gate = vi.fn(() => void Session.new());

    const first = await walk(request(), ["app"], [undefined, gate], () => Session.get());
    const second = await walk(request(), ["app", "inner"], [undefined, gate], () => Session.get());

    expect(gate).toHaveBeenCalledTimes(2);
    expect(first.user).toBe("ada");
    expect(second).not.toBe(first);
    expect(first.get(null)).toBe(true);
    await expect(walk(request(), ["app"], [], () => Session.get())).rejects.toThrow("Could not find Session in context.");
  });

  it("will wait for each Model a gate activates, even after an await or built bare and set", async () => {
    let done!: () => void;
    class Session extends Model {
      user?: string = undefined;
      protected async new() {
        await new Promise<void>(resolve => (done = resolve));
        this.user = "ada";
      }
    }
    class Tenant extends Model {}
    const run = vi.fn(() => [Session.get().user, Tenant.get()]);
    const call = walk(request(), [], [async () => {
      new Session().set();
      await tick();
      Tenant.new();
    }], run);

    await tick();
    await tick();
    expect(run).not.toHaveBeenCalled();

    done();
    expect(await call).toEqual(["ada", expect.any(Tenant)]);
  });

  it("will keep each call's Models apart", async () => {
    class Session extends Model { user = ""; }
    const gate = () => void Session.new({ user: Current.get().url.searchParams.get("user")! });

    const users = await Promise.all(["ada", "bob"].map(user => walk(request(`/?user=${user}`), [], [gate], async () => (await tick(), Session.get().user))));

    expect(users).toEqual(["ada", "bob"]);
  });

  it("will refuse a call whose gate throws", async () => {
    const run = vi.fn();

    await expect(walk(request(), [], [() => { throw new Denied("Sign in."); }], run)).rejects.toBeInstanceOf(Denied);
    expect(run).not.toHaveBeenCalled();
  });

  it("will refuse a call when a Model the gate activates fails its new(), unreported", async () => {
    class Session extends Model {
      protected async new() {
        await tick();
        throw new Denied("Expired.");
      }
    }
    let built!: Session;
    const run = vi.fn();
    const failed = vi.fn();

    process.on("uncaughtException", failed);

    try {
      await expect(walk(request(), ["app"], [undefined, () => void (built = Session.new())], run)).rejects.toThrow("Expired.");
      await tick();
    } finally {
      process.off("uncaughtException", failed);
    }

    expect(run).not.toHaveBeenCalled();
    expect(built.get(null)).toBe(true);
    expect(failed).not.toHaveBeenCalled();
  });

  it("will refuse with the error of a Model that fails before the gate returns", async () => {
    class Session extends Model {
      protected async new() {
        throw new Denied("Expired.");
      }
    }
    const run = vi.fn();

    await expect(walk(request(), [], [async () => {
      Session.new();
      await tick();
    }], run)).rejects.toThrow("Expired.");
    expect(run).not.toHaveBeenCalled();
  });

  it("will take a Model activated in a captured Model's async new() as the call's own", async () => {
    class Profile extends Model { name = "ada"; }
    class Session extends Model {
      protected async new() {
        await tick();
        Profile.new();
      }
    }

    const profile = await walk(request(), [], [() => void Session.new()], () => Profile.get());

    expect(profile.name).toBe("ada");
    expect(profile.get(null)).toBe(true);
  });

  it("will not refuse a call for a Model its gate destroys", async () => {
    class Temp extends Model {}

    expect(await walk(request(), [], [() => void Temp.new().set(null)], () => "ok")).toBe("ok");
  });

  it("will drop a gated folder's layer once no call holds it", async () => {
    class Session extends Model { user = "ada"; }
    const gate = () => void Session.new();
    const pop = vi.spyOn(Context.prototype, "pop");
    let release!: () => void;
    const held = new Promise<void>(resolve => (release = resolve));

    try {
      const slow = walk(request(), ["app"], [undefined, gate], async () => (await held, Session.get().user));

      await walk(request(), ["app"], [undefined, gate], () => {});
      const quick = pop.mock.calls.length;

      release();
      expect(await slow).toBe("ada");
      expect([quick, pop.mock.calls.length]).toEqual([1, 3]);
    } finally {
      pop.mockRestore();
    }
  });

  it("will report a Model's failed new() outside a gate as usual", async () => {
    class Late extends Model {
      protected async new() {
        throw new Error("late");
      }
    }
    const escaped: unknown[] = [];
    const queue = globalThis.queueMicrotask;
    const spy = vi.spyOn(globalThis, "queueMicrotask").mockImplementation(task => queue(() => {
      try {
        task();
      } catch (error) {
        escaped.push(error);
      }
    }));

    try {
      await walk(request(), [], [() => {}], () => void Late.new());
      await tick();
    } finally {
      spy.mockRestore();
    }

    expect(escaped).toEqual([new Error("late")]);
  });

  it("will run an inner gate with the outer gate's Models in reach, and seats below it per call", async () => {
    class Session extends Model { user = "ada"; }
    class Admin extends Model {
      protected new() {
        if (Session.get().user !== "ada") throw new Denied("Admins only.");
      }
    }
    class Panel extends Model { static ttl = 60; }

    const [admin, panel] = await walk(request(), ["admin", "panel"], [() => void Session.new(), () => void Admin.new(), Panel], () => [Admin.get(), Panel.get()]);

    expect(admin).toBeInstanceOf(Admin);
    expect(panel.get(null)).toBe(true);
  });
});

describe("Current", () => {
  it("will read the request in progress", async () => {
    const seen = await within(request("/tally?x=1", "a=1; b=x%20y"), ["tally"], () => {
      const { url, cookies, request } = Current.get();
      return { path: url.pathname, query: url.searchParams.get("x"), cookies, method: request.headers.get("cookie") };
    });

    expect(seen).toEqual({ path: "/tally", query: "1", cookies: { a: "1", b: "x y" }, method: "a=1; b=x%20y" });
  });

  it("will read no cookies from a request without them", async () => {
    expect(await within(new Request("http://localhost/"), [], () => Current.get().cookies)).toEqual({});
  });

  it("will read the bindings given its request, else none", async () => {
    const req = request("/");
    const env = { DB: "db" };

    bind(req, env);

    expect(await within(req, [], () => Current.get().env)).toBe(env);
    expect(await call([], () => Current.get().env)).toEqual({});
  });

  it("will refuse writes", async () => {
    await call([], () => {
      const current = Current.get() as any;
      expect(() => { current.env = {}; }).toThrow("Current is read-only.");
      expect(() => { current.request = {}; }).toThrow("Current is read-only.");
      expect(() => { current.url = {}; }).toThrow("Current is read-only.");
      expect(() => { current.cookies = {}; }).toThrow("Current is read-only.");
      expect(() => { current.params = {}; }).toThrow("Current is read-only.");
      expect(() => { current.ctx = {}; }).toThrow("Current is read-only.");
      expect(() => { current.next = () => {}; }).toThrow("Current is read-only.");
    });
  });
  it("will gather headers for the reply", async () => {
    const req = new Request("https://example.com/");

    expect(headersOf(req)).toBeUndefined();

    await within(req, [], () => {
      const current = Current.get();

      current.setHeader("cache-control", "no-store");
      current.setHeader("cache-control", "private");
      current.setHeader("Set-Cookie", "raw=1");
      current.setHeader("set-cookie", "raw=2");
    });

    const headers = headersOf(req)!;

    expect(headers.get("cache-control")).toBe("private");
    expect(headers.getSetCookie()).toEqual(["raw=1", "raw=2"]);
  });
});

describe("pool", () => {
  class Cart extends Model {}

  const parentOf = (state: Model) => Context.get(state).parent;

  it("will build an instance of its own in the call's layer, holding the layer alive", async () => {
    const a = await call(["shop"], () => construct(Cart));
    const b = await call(["shop"], () => construct(Cart));

    expect(a.instance).not.toBe(b.instance);
    expect(parentOf(a.instance)).toBe(parentOf(b.instance));

    a.drop();
    a.drop();
    expect(a.instance.get(null)).toBe(true);

    const c = await call(["shop"], () => construct(Cart));
    expect(parentOf(c.instance)).toBe(parentOf(b.instance));

    expect(await call(["shop"], () => b.current())).toBe(true);
    expect(await call(["other"], () => b.current())).toBe(false);

    b.drop();
    expect(await call(["shop"], () => b.current())).toBe(false);
    c.drop();

    const d = await call(["shop"], () => construct(Cart));
    expect(parentOf(d.instance)).not.toBe(parentOf(b.instance));
    d.drop();
  });

  it("will build off any layer when detached", async () => {
    const a = construct(Cart, true);
    const b = construct(Cart, true);

    expect(parentOf(a.instance)).toBe(parentOf(b.instance));
    expect(Context.get(a.instance).get(Current)).toBeInstanceOf(Current);

    expect(await call(["any"], () => a.current())).toBe(true);
    a.drop();
    expect(a.instance.get(null)).toBe(true);
    expect(a.current()).toBe(false);
  });
});

describe("hooks", () => {
  it("will find the seat of the call's layer", async () => {
    class Blog extends Model {}

    expect(await within(request(), ["unseated"], () => seated())).toBeUndefined();
    expect(await walk(request(), ["blog"], [undefined, Blog], () => seated() === Blog.get())).toBe(true);
  });

  it("will hand each seat and construction it builds to the build hook", async () => {
    class Blog extends Model {}
    class Cart extends Model {}
    const built = vi.fn();

    onBuild(built);

    const seat = await walk(request(), ["shelf"], [undefined, Blog], () => Blog.get());
    const cart = await call(["shelf"], () => construct(Cart));

    expect(built.mock.calls).toEqual([[seat], [cart.instance]]);
    cart.drop();
  });
});

describe("layer", () => {
  const ok = async () => new Response("below");
  const open = (run: () => unknown, below?: () => Promise<Response>, req = request()) => within(req, [], () => layer(run, below));
  const tick = () => new Promise(resolve => setTimeout(resolve));
  let error: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => {});
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    error.mockRestore();
    warn.mockRestore();
  });

  it("will throw outside a request", () => {
    expect(() => layer(() => {})).toThrow("Server Model resolves only within a request.");
  });

  it("will pass a gate that finishes, and answer one that returns a Response", async () => {
    expect(await (await open(() => {}, ok)).text()).toBe("below");
    expect(await (await open(() => 42, ok)).text()).toBe("below");
    expect(await (await open(() => new Response("gate"), ok)).text()).toBe("gate");
  });

  it("will answer a route's value by the body rule, nothing as 204", async () => {
    expect(await (await open(() => ({ a: 1 }))).json()).toEqual({ a: 1 });
    expect(await (await open(() => 404)).json()).toBe(404);
    expect((await open(() => {})).status).toBe(204);
  });

  it("will call a returned function as a fetch handler with the request, env and ctx", async () => {
    const req = request("/x");
    const env = { KEY: "k" };
    const handler = vi.fn(async () => "handled");

    bind(req, env);

    const res = await open(() => handler, undefined, req);

    expect(await res.text()).toBe("handled");
    expect(handler).toHaveBeenCalledWith(expect.any(Request), env, expect.objectContaining({ props: {} }));
    expect(await (await open(() => () => {})).status).toBe(204);
    expect(await (await open(() => () => {}, ok)).text()).toBe("below");
    expect((await open(() => () => () => {})).status).toBe(500);
    expect(error).toHaveBeenCalledWith(new TypeError("A fetch handler returned a function - return a Response."));
  });

  it("will hand an unbound request's fetch handler an empty env", async () => {
    expect(await (await open(() => (_: Request, env: unknown) => Response.json(env))).json()).toEqual({});
  });

  it("will answer a refusal's HttpError status, a Redirect's location, anything else a logged 500", async () => {
    const denied = await open(() => { throw new Forbidden("No."); }, ok);
    const moved = await open(() => { throw new Redirect("/login"); }, ok);
    const broken = await open(() => { throw new Error("boom"); }, ok);

    expect([denied.status, await denied.json()]).toEqual([403, { message: "No." }]);
    expect([moved.status, moved.headers.get("location")]).toEqual([302, "/login"]);
    expect(broken.status).toBe(500);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("will show a 500's message with dev", async () => {
    const broken = await within(request(), [], () => layer(() => { throw new Error("boom"); }, undefined, {}, true));

    expect([broken.status, await broken.json()]).toEqual([500, { message: "boom" }]);
  });

  it("will refuse with the error of a Model the gate activates", async () => {
    class Session extends Model {
      async new() {
        throw new Forbidden("Expired.");
      }
    }

    const below = vi.fn(ok);
    const res = await open(() => void Session.new(), below);

    expect(res.status).toBe(403);
    expect(below).not.toHaveBeenCalled();
  });

  it("will give params to the layer that has them, and none in a call", async () => {
    const seen: unknown[] = [];

    await within(request(), [], () =>
      layer(() => void seen.push(Current.get().params), () => layer(() => void seen.push(Current.get().params), undefined, { id: "7" }), { org: "a" }));

    expect(seen).toEqual([{ org: "a" }, { id: "7" }]);
    expect(await call([], () => Current.get().params)).toEqual({});
  });

  it("will keep a gate's Models in reach below it until the request ends", async () => {
    class Session extends Model { user = "ada"; }
    let session!: Session;

    const res = await open(() => void (session = Session.new()), () => layer(() => Session.get().user));

    expect(await res.text()).toBe("ada");
    expect(session.get(null)).toBe(true);
  });

  it("will join headers and cookies a layer sets to its reply, one cookie once", async () => {
    class Session extends Cookies { id?: string = undefined; }
    const req = request();

    const res = await open(async () => {
      const { next, setHeader } = Current.get();

      setHeader("x-gate", "1");
      Session.set({ id: "a" });

      const reply = await next();

      expect(reply.headers.get("x-route")).toBe("1");
      expect(reply.headers.getSetCookie()).toEqual(["id=b; Path=/; HttpOnly; SameSite=Lax"]);

      Session.set({ id: "c" });
    }, () => layer(() => {
      Current.get().setHeader("x-route", "1");
      Session.set({ id: "b" });
    }), req);

    expect(res.headers.get("x-gate")).toBe("1");
    expect(res.headers.get("x-route")).toBe("1");
    expect(res.headers.getSetCookie()).toEqual(["id=b; Path=/; HttpOnly; SameSite=Lax", "id=c; Path=/; HttpOnly; SameSite=Lax"]);
  });

  describe("next", () => {
    it("will wait for the gate's Models, run below once and resolve its reply", async () => {
      let ready!: () => void;
      const order: string[] = [];

      class Session extends Model {
        async new() {
          await new Promise<void>(resolve => (ready = resolve));
          order.push("ready");
        }
      }

      const pending = open(async () => {
        Session.new();
        const reply = await Current.get().next();
        order.push("passed");
        return reply;
      }, async () => {
        order.push("below");
        return new Response("below");
      });

      await tick();
      expect(order).toEqual([]);
      ready();

      expect(await (await pending).text()).toBe("below");
      expect(order).toEqual(["ready", "below", "passed"]);
    });

    it("will refuse when a gate's Model fails, even with next() unreturned", async () => {
      class Session extends Model {
        async new() {
          throw new Forbidden("Expired.");
        }
      }

      const awaited = await open(async () => {
        Session.new();
        await Current.get().next();
      }, ok);

      const loose = await open(() => {
        Session.new();
        void Current.get().next();
      }, ok);

      expect(awaited.status).toBe(403);
      expect(loose.status).toBe(403);
    });

    it("will resolve a throw below as its error reply", async () => {
      const gate = async () => new Response(String((await Current.get().next()).status));

      expect(await (await open(gate, async () => { throw new Forbidden("No."); })).text()).toBe("403");
      expect(await (await open(gate, () => { throw new Forbidden("No."); })).text()).toBe("403");
    });

    it("will throw a second time, in a route and in a call, but not when read", async () => {
      const res = await open(async () => {
        const { next } = Current.get();
        await next();
        expect(() => next()).toThrow("next() runs once per gate.");
      }, ok);

      expect(await res.text()).toBe("below");
      await open(() => expect(() => Current.get().next()).toThrow("next() runs only in a gate"));
      await call([], () => expect(() => Current.get().next()).toThrow("next() runs only in a gate"));
    });

    it("will cancel the body of a reply it discards", async () => {
      const cancel = vi.fn();

      await open(async () => {
        await Current.get().next();
        return new Response("swapped");
      }, async () => new Response(new ReadableStream({ cancel })));

      expect(cancel).toHaveBeenCalled();
    });

    it("will keep a reply's body its own reply still reads", async () => {
      async function* upper(body: ReadableStream<Uint8Array>) {
        const reader = body.getReader();
        for (let read = await reader.read(); !read.done; read = await reader.read()) yield new TextDecoder().decode(read.value).toUpperCase();
      }

      const res = await open(async () => {
        const reply = await Current.get().next();
        await Current.get().send(200, upper(reply.body!));
      }, ok);

      expect(await res.text()).toBe("BELOW");
    });

    it("will keep a gate's cookie from before next on a reply it swaps, under a newer one below", async () => {
      class Session extends Cookies { id?: string = undefined; }

      const gate = (swap: boolean) => async () => {
        Session.set({ id: "gate" });
        const reply = await Current.get().next();
        return swap ? new Response("swapped") : reply;
      };
      const below = () => layer(() => Session.set({ id: "below" }));

      expect((await open(gate(true), below)).headers.getSetCookie()).toEqual(["id=gate; Path=/; HttpOnly; SameSite=Lax"]);
      expect((await open(gate(false), below)).headers.getSetCookie()).toEqual(["id=below; Path=/; HttpOnly; SameSite=Lax"]);

      const rewrapped = async () => {
        Session.set({ id: "gate" });
        const reply = await Current.get().next();
        return new Response(reply.body, reply);
      };

      expect((await open(rewrapped, below)).headers.getSetCookie()).toEqual(["id=below; Path=/; HttpOnly; SameSite=Lax"]);
    });

    it("will cancel a reply below that arrives after the gate answered", async () => {
      const cancel = vi.fn();
      let arrive!: () => void;

      const res = await open(async () => {
        void Current.get().next();
        await Current.get().send("early");
      }, async () => {
        await new Promise<void>(resolve => (arrive = resolve));
        return new Response(new ReadableStream({ cancel }));
      });

      expect(await res.text()).toBe("early");
      arrive();
      await tick();
      expect(cancel).toHaveBeenCalled();
    });
  });

  describe("send", () => {
    it("will decide the reply, resolving once it has left, with after-work through ctx.waitUntil", async () => {
      const req = request();
      const order: string[] = [];
      const waitUntil = vi.fn();
      let work!: Promise<void>;

      bind(req, {}, { waitUntil });

      const res = await open(() => {
        work = (async () => {
          await Current.get().send(201, { ok: true });
          order.push("after");
          Current.get().ctx;
        })();
      }, undefined, req);

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ ok: true });
      await work;
      expect(order).toEqual(["after"]);
      expect(waitUntil).toHaveBeenCalledTimes(1);
    });

    it("will throw twice, from a call, or for a function; setHeader after it throws", async () => {
      await open(async () => {
        const { send, setHeader } = Current.get();

        await expect(send(() => {})).rejects.toThrow("Cannot send a function");
        void send("one");
        await expect(send("two")).rejects.toThrow("This reply is already decided.");
        await tick();
        await expect(send("three")).rejects.toThrow("This reply is already decided.");
        expect(() => setHeader("x", "1")).toThrow("Cannot set x - this reply is already decided.");
      });

      await call([], async () => {
        await expect(Current.get().send()).rejects.toThrow("send() belongs to a gate or route");
      });
    });

    it("will build nothing and leave no rejection unhandled when the gate's Models fail", async () => {
      class Session extends Model {
        async new() {
          throw new Forbidden("Expired.");
        }
      }

      const stream = new ReadableStream();
      const awaited = await open(async () => {
        Session.new();
        await Current.get().send(200, stream);
      });
      const loose = await open(() => {
        Session.new();
        void Current.send(200);
      });

      expect([awaited.status, loose.status]).toEqual([403, 403]);
      expect(stream.locked).toBe(false);
    });

    it("will refuse with what an unawaited send throws, and log a second one", async () => {
      const res = await open(() => {
        void Current.send(200, new Map());
      });

      await open(() => {
        void Current.send("one");
        void Current.send("two");
      });

      const awaited = await open(() => Current.send(200, new Map()));
      const gated = await within(request(), ["a"], () => "called", [() => void Current.send(200, new Map())], () => "refused");

      await tick();
      expect([res.status, awaited.status, gated]).toEqual([500, 500, "refused"]);
      expect(error.mock.calls.filter((call: unknown[]) => call[0] instanceof TypeError)).toHaveLength(2);
      expect(error).toHaveBeenCalledWith(new Error("This reply is already decided."));
    });

    it("will hold the request while a next() left running is still below", async () => {
      class Session extends Model {}
      let session!: Session;
      let finish!: () => void;
      let alive: boolean | undefined;

      const res = await open(async () => {
        session = Session.new();
        void Current.get().next();
        await Current.get().send(200);
      }, async () => {
        await new Promise<void>(resolve => (finish = resolve));
        alive = !session.get(null);
        return new Response("late");
      });

      expect(res.status).toBe(200);
      await tick();
      finish();
      await tick();
      expect(alive).toBe(true);
      expect(session.get(null)).toBe(true);
    });

    it("will throw when another answer lands while it waits for the gate's Models", async () => {
      let ready!: () => void;

      class Session extends Model {
        async new() {
          await new Promise<void>(resolve => (ready = resolve));
        }
      }

      let late!: Promise<void>;

      const res = await open(async () => {
        Session.new();
        late = Current.get().send("late");
        throw new Forbidden("No.");
      });

      ready();
      expect(res.status).toBe(403);
      await expect(late).rejects.toThrow("This reply is already decided.");
    });

    it("will answer a send left unawaited once the gate's Models are ready", async () => {
      class Session extends Model {
        async new() {
          await tick();
        }
      }

      const res = await open(() => {
        Session.new();
        void Current.get().send("sent");
      }, ok);

      expect(await res.text()).toBe("sent");
    });

    it("will send through the static", async () => {
      expect(await (await open(() => void Current.send("static"))).text()).toBe("static");
    });

    it("will warn of a value returned after the reply, and log a throw in after-work", async () => {
      await open(async () => {
        await Current.get().send();
        return "ignored";
      });

      await open(async () => {
        await Current.get().send();
        throw new Error("after");
      });

      await tick();
      expect(warn).toHaveBeenCalledWith("A value returned after the reply was decided is ignored.");
      expect(error).toHaveBeenCalledWith(new Error("after"));
    });

    it("will resolve when the client aborts", async () => {
      const aborted = new AbortController();
      const req = new Request("http://localhost/", { signal: aborted.signal });
      let sent!: Promise<void>;
      let hold!: () => void;

      const done = within(req, [], async () => {
        await layer(() => void (sent = Current.get().send("x")));
        await new Promise<void>(resolve => (hold = resolve));
        return new Response();
      });

      await tick();
      aborted.abort();
      await sent;
      hold();
      await done;

      const gone = new AbortController();
      gone.abort();
      await within(new Request("http://localhost/", { signal: gone.signal }), [], () => layer(() => Current.send()));
    });

    it("will drop a cookie set after the reply left, warning", async () => {
      class Session extends Cookies { id?: string = undefined; }

      await open(async () => {
        Session.get();
        await Current.get().send();
        Session.set({ id: "late" });
      });

      await tick();
      expect(warn).toHaveBeenCalledWith("Cookies set with no reply left to carry them were dropped.");
    });
  });

  describe("stream", () => {
    it("will hold the request until its body closes, each pull in the request's scope", async () => {
      class Session extends Model { user = "ada"; }
      let session!: Session;

      async function* lines() {
        yield Session.get().user;
        yield "!";
      }

      const res = await open(() => {
        session = Session.new();
        return lines();
      });

      await tick();
      expect(session.get(null)).toBe(false);
      expect(await res.text()).toBe("ada!");
      expect(session.get(null)).toBe(true);
    });

    it("will release on cancel, and abort the body and log a throw mid-stream", async () => {
      class Session extends Model {}
      let session!: Session;

      async function* broken() {
        yield "a";
        throw new Error("mid");
      }

      const cancelled = await open(() => {
        session = Session.new();
        return new ReadableStream({ pull: controller => controller.enqueue(new Uint8Array([1])) });
      });

      await cancelled.body!.cancel();
      expect(session.get(null)).toBe(true);

      const failed = await open(() => broken());

      await expect(failed.text()).rejects.toThrow("mid");
      expect(error).toHaveBeenCalledWith(new Error("mid"));
    });

    it.each([true, false])("will release once and stop the source in scope when cancelled mid-pull", async settles => {
      class Session extends Model {}
      let session!: Session;
      let resume!: () => void;
      let stopped: unknown;

      const source = {
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<string>>((resolve, reject) => (resume = () => (settles ? resolve({ done: false, value: "x" }) : reject(new Error("gone"))))),
          return: async () => ((stopped = Session.get()), { done: true as const, value: undefined }),
        }),
      };

      const res = await open(() => {
        session = Session.new();
        return source;
      });

      const reader = res.body!.getReader();
      const read = reader.read();

      await tick();
      await reader.cancel();
      resume();
      await read;
      await tick();

      expect(stopped).toBe(session);
      expect(session.get(null)).toBe(true);
      expect(error).not.toHaveBeenCalled();
    });

    it("will release a generator cancelled mid-pull after its finally, logging nothing", async () => {
      class Session extends Model {}
      let session!: Session;
      let resume!: () => void;
      let closing: boolean | undefined;

      async function* lines() {
        try {
          await new Promise<void>(resolve => (resume = resolve));
          yield "x";
        } finally {
          closing = !session.get(null);
        }
      }

      const res = await open(() => {
        session = Session.new();
        return lines();
      });

      const reader = res.body!.getReader();
      const read = reader.read();

      await tick();
      const cancelled = reader.cancel();
      resume();
      await Promise.all([read, cancelled]);
      await tick();

      expect(closing).toBe(true);
      expect(session.get(null)).toBe(true);
      expect(error).not.toHaveBeenCalled();
    });

    it("will stream bytes sent from a gate", async () => {
      const res = await open(async () => {
        await Current.get().send(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("hi"));
            controller.close();
          },
        }));
      });

      expect(await res.text()).toBe("hi");
    });
  });

  describe("body", () => {
    it("will read the body in a layer, capped, and refuse it in a call", async () => {
      const req = () => new Request("http://localhost/", { method: "POST", body: '{"a":1}', headers: { "content-type": "application/json" } });

      expect(await (await within(req(), [], () => layer(() => Current.get().json()))).json()).toEqual({ a: 1 });
      expect(await (await within(req(), [], () => layer(() => Current.get().text()))).text()).toBe('{"a":1}');

      await within(req(), [], async () => {
        const { json, text } = Current.get();

        expect(() => json()).toThrow("json() belongs to a gate or route");
        expect(() => text()).toThrow("text() belongs to a gate or route");
      });
    });

    it("will read through one cache the request and the call's arguments share", async () => {
      const origin = new Request("http://localhost/", { method: "POST", body: "[1]", headers: { "content-type": "application/json" } });

      await within(origin, [], () =>
        layer(async () => {
          expect(await Current.get().request.text()).toBe("[1]");
          expect(await Current.get().json()).toEqual([1]);
        }, async () => new Response(await Current.get().request.text())));
    });
  });

  describe("ctx", () => {
    it("will fill what the host lacks with stand-ins", async () => {
      const req = request();
      const pass = vi.fn();

      bind(req, {}, { passThroughOnException: pass, props: { a: 1 } });

      const ctx = await within(req, [], () => Current.get().ctx);

      ctx.passThroughOnException();
      ctx.waitUntil(Promise.reject(new Error("late")));
      await tick();

      expect(pass).toHaveBeenCalled();
      expect(ctx.props).toEqual({ a: 1 });
      expect(error).toHaveBeenCalledWith("waitUntil:", new Error("late"));

      const bare = await call([], () => Current.get().ctx);

      bare.passThroughOnException();
      expect(bare.props).toEqual({});
    });
  });

  describe("call gates", () => {
    it("will wrap a call with next, resolving its reply", async () => {
      const gate = vi.fn(async () => {
        const reply = (await Current.get().next()) as unknown as string;
        expect(reply).toBe("called");
      });

      expect(await walk(request(), ["app"], [undefined, gate], () => "called")).toBe("called");
    });

    it("will answer a call from its gate, the call unrun", async () => {
      const run = vi.fn();
      const res = await walk(request(), ["app"], [undefined, () => new Response("gate")], run) as unknown as Response;

      expect(await res.text()).toBe("gate");
      expect(run).not.toHaveBeenCalled();
    });

    it("will reply a seat's or gate's refusal through fail", async () => {
      class Locked extends Model {
        static key(): string {
          throw new Forbidden("Locked.");
        }
      }

      const fail = (error: unknown) => (error as Error).message;

      expect(await within(request(), ["a"], () => "ok", [undefined, Locked], fail)).toBe("Locked.");
      expect(await within(request(), ["a"], () => "ok", [() => { throw new Forbidden("Gate."); }], fail)).toBe("Gate.");
    });

    it("will hold a seat once for the calls one request runs", async () => {
      class Tally extends Model {}
      const req = request();

      let first!: Tally;
      let second!: Tally;

      await within(req, [], () =>
        layer(async () => {
          first = await within(req, ["t"], () => Tally.get(), [undefined, Tally]);
          second = await within(req, ["t"], () => Tally.get(), [undefined, Tally]);
        }));

      expect(first).toBe(second);
      expect(first.get(null)).toBe(true);
    });

    it("will share the request's scope with a call it runs", async () => {
      const req = request();

      await within(req, [], () =>
        layer(async () => {
          const outer = Current.get().request;
          expect(await within(req, [], () => Current.get().request)).toBe(outer);
        }));
    });
  });
});

import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { matchPattern } from "@expressive/router";
import { Current, HttpError, NotFound, Redirect } from "@expressive/rpc";

import { compose, refuse, routed } from "./compose";
import { install } from "./install";

install();

class Taken extends HttpError {
  status = 409;
}

const calls = {
  async add(a: number, b: number) {
    if (!b) throw new Taken("zero");
    return a + b;
  },
  async where() {
    return [store.getStore() ?? null, Current.get().url.pathname, Current.get().env];
  },
  async later() {
    Current.get().ctx.waitUntil(Promise.resolve());
  },
};

const store = new AsyncLocalStorage<string>();
const sidecars = () => [{ pattern: ["tally"], exports: async () => ({ calls, classes: { Taken } }) }];

const call = (name: string, args: unknown[], headers: Record<string, string> = {}) =>
  new Request("http://localhost/tally", { method: "POST", headers: { "content-type": "application/json", "x-expressive-call": name, ...headers }, body: JSON.stringify(args) });

const page = (path = "/", init?: RequestInit) => new Request(`http://localhost${path}`, init);

const assets = { fetch: async (request: Request) => new Response(`page ${new URL(request.url).pathname}`, { headers: { "content-type": "text/html" } }) };

let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  error.mockRestore();
});

describe("compose", () => {
  it("will answer calls, then pages through assets, else 404", async () => {
    const app = compose({}, { sidecars });

    expect(await (await app(call("add", [2, 3]))).json()).toEqual({ value: 5 });
    expect(await (await app(page("/about"), { assets })).text()).toBe("page /about");
    expect((await app(page("/about"))).status).toBe(404);
    expect((await compose()(call("add", [1, 2]))).status).toBe(404);
  });

  it("will answer calls under base and none outside it, a base not starting with / counting as /", async () => {
    const at = (path: string) => new Request(`http://localhost${path}`, call("add", [2, 3]));
    const app = compose({}, { sidecars, base: "/app/" });

    expect(await (await app(at("/app/tally"))).json()).toEqual({ value: 5 });
    expect((await app(at("/tally"))).status).toBe(404);
    expect(await (await compose({}, { sidecars, base: "./" })(at("/tally"))).json()).toEqual({ value: 5 });
  });

  it("will bind env and ctx for the request's scope", async () => {
    const waitUntil = vi.fn();
    const app = compose({}, { sidecars });
    const reply = await app(call("where", []), { env: { NAME: "prod" } as object, ctx: { waitUntil } });

    expect(await reply.json()).toEqual({ value: [null, "/tally", { NAME: "prod" }] });
    await app(call("later", []), { ctx: { waitUntil } });
    expect(waitUntil).toHaveBeenCalled();
  });

  it("will reply a call's thrown class with its status, and a throw in assets as a logged 500", async () => {
    const app = compose({}, { sidecars });
    const taken = await app(call("add", [1, 0]));
    const broken = await app(page(), { assets: { fetch: async () => { throw new Error("disk"); } } });

    expect([taken.status, (await taken.json()).message]).toEqual([409, "zero"]);
    expect([broken.status, await broken.json()]).toEqual([500, { message: "Internal error." }]);
    expect(error).toHaveBeenCalledWith(new Error("disk"));
  });

  it("will throw on creation for a setting it does not read, but not for index.dev.ts's env", () => {
    expect(() => compose({ fetch: () => {} } as object)).toThrow("`fetch` and `around` became `handle`.");
    expect(() => compose({ env: () => ({}) })).not.toThrow();
  });
});

describe("pages", () => {
  const html = { accept: "text/html" };
  const pages = { patterns: ["/", "/blog/:slug"] };
  const host = (files: Record<string, () => Response>) => {
    const seen: string[] = [];
    const fetch = async (request: Request) => {
      const { pathname } = new URL(request.url);
      const conditional = ["if-none-match", "range"].filter(name => request.headers.has(name)).join(",");
      seen.push(`${request.method} ${pathname} ${conditional}`.trim());
      return files[pathname]?.() ?? new Response("missing", { status: 404 });
    };
    return { seen, fetch };
  };
  const text = async (reply: Response) => `${reply.status} ${await reply.text()}`;

  it("will answer a page route with the shell as 200, and an unmatched navigation as 404", async () => {
    const assets = host({ "/200.html": () => new Response("shell"), "/app.js": () => new Response("js") });
    const app = compose({}, { pages });
    const unknown = await app(page("/nope", { headers: html }), { assets });

    expect(await text(await app(page("/app.js"), { assets }))).toBe("200 js");
    expect(await text(await app(page("/blog/a", { headers: { "if-none-match": "x", range: "bytes=0-1" } }), { assets }))).toBe("200 shell");
    expect([await text(unknown), unknown.headers.get("vary")]).toEqual(["404 shell", "accept"]);
    expect((await app(page("/blog/a", { method: "HEAD" }), { assets })).status).toBe(200);
    expect(assets.seen).toEqual(["GET /nope", "GET /200.html", "GET /app.js", "GET /blog/a if-none-match,range", "GET /200.html", "HEAD /blog/a", "HEAD /200.html"]);
  });

  it("will answer anything else with the bare 404, and other methods without assets", async () => {
    const assets = host({ "/200.html": () => new Response("shell") });
    const app = compose({}, { pages: { ...pages, assetsDir: "static" } });
    const other = await app(page("/nope"), { assets });

    expect([await text(other), other.headers.get("vary")]).toEqual(["404 missing", "accept"]);
    expect(await text(await app(page("/static/gone.js", { headers: html }), { assets }))).toBe("404 missing");
    expect(await text(await app(page("/200.html", { method: "POST", headers: html }), { assets }))).toBe("404 Not found.");
    expect(await text(await app(page("/blog/a"), { assets: host({}) }))).toBe("404 missing");
  });

  it("will serve the shell to every navigation, and only to one, without patterns", async () => {
    const assets = host({ "/200.html": () => new Response("shell") });
    const app = compose({}, { pages: {} });

    expect(await text(await app(page("/deep/link", { headers: html }), { assets }))).toBe("200 shell");
    expect(await text(await app(page("/favicon.ico"), { assets }))).toBe("404 missing");
  });

  it("will fall back to index.html, following one same-origin redirect", async () => {
    const assets = host({
      "/index.html": () => new Response(null, { status: 307, headers: { location: "/" } }),
      "/": () => new Response("home"),
    });
    const twice = host({
      "/200.html": () => new Response(null, { status: 307, headers: { location: "/200" } }),
      "/200": () => new Response(null, { status: 307, headers: { location: "/shell" } }),
      "/shell": () => new Response("shell"),
    });
    const away = host({ "/200.html": () => new Response(null, { status: 307, headers: { location: "http://elsewhere/200" } }) });
    const app = compose({}, { pages });

    expect(await text(await app(page("/blog/a"), { assets }))).toBe("200 home");
    expect(assets.seen).toEqual(["GET /blog/a", "GET /200.html", "GET /index.html", "GET /"]);
    expect(await text(await app(page("/blog/a"), { assets: twice }))).toBe("404 missing");
    expect(twice.seen).toEqual(["GET /blog/a", "GET /200.html", "GET /200", "GET /index.html"]);
    expect(await text(await app(page("/blog/a"), { assets: away }))).toBe("404 missing");
  });
});

describe("routed", () => {
  const patterns = ["/", "/blog/:slug", "/docs/*", "/a/:b/c", "/*"];
  const paths = ["/", "", "//", "/blog/a", "/Blog/A/", "/blog//a", "/blog", "/blog/a/b", "/blog/a%20b", "/docs", "/docs/", "/docs/a/b", "/DOCS/x", "/doc", "/a/x/c", "/a//c", "/a/x/C/", "/x/y"];

  it("will match a page route as the router does", () => {
    for (const pattern of patterns)
      for (const path of paths)
        expect([pattern, path, routed([pattern], path)]).toEqual([pattern, path, matchPattern(pattern, path) !== null]);
  });
});

describe("handle", () => {
  it("will run around calls and pages, outside the request's scope, with the inside in next", async () => {
    const seen: string[] = [];
    const app = compose({
      handle({ request, next }) {
        seen.push(new URL(request.url).pathname);
        expect(() => Current.get()).toThrow();
        return store.run("inside", () => next());
      },
    }, { sidecars });

    expect(await (await app(call("where", []))).json()).toEqual({ value: ["inside", "/tally", {}] });
    expect(await (await app(page("/a"), { assets })).text()).toBe("page /a");
    expect(seen).toEqual(["/tally", "/a"]);
  });

  it("will answer with a returned Response, and pass by returning nothing", async () => {
    const app = compose({
      handle({ request }) {
        if (request.headers.has("x-answer")) return new Response("handled");
      },
    });

    expect(await (await app(page("/", { headers: { "x-answer": "1" } }), { assets })).text()).toBe("handled");
    expect(await (await app(page("/b"), { assets })).text()).toBe("page /b");
  });

  it("will pass through next's reply when it returns nothing after calling it", async () => {
    const statuses: number[] = [];
    const app = compose({
      async handle({ next }) {
        statuses.push((await next()).status);
      },
    });

    expect(await (await app(page("/c"), { assets })).text()).toBe("page /c");
    expect(statuses).toEqual([200]);
  });

  it("will warn once in dev when the app fails after a handle that returned nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = { fetch: async () => Promise.reject(new Error("no session")) };
    const handle = () => {};

    try {
      await compose({ handle })(page("/"), { assets: failing });
      await compose({ handle }, { dev: true })(page("/"), { assets });
      expect(warn).not.toHaveBeenCalled();

      const app = compose({ handle }, { dev: true });
      const unavailable = { fetch: async () => new Response("down", { status: 503 }) };

      expect((await app(page("/"), { assets: unavailable })).status).toBe(503);
      expect((await app(page("/"), { assets: failing })).status).toBe(500);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("If handle wraps the app in something (a session, a transaction), it must return next() inside the wrapper"));
    } finally {
      warn.mockRestore();
    }
  });

  it("will forward a rewritten request, and throw for anything else", async () => {
    const app = compose({
      handle({ request, next }) {
        if (request.headers.has("x-wrap")) return Promise.resolve((next as (value: unknown) => Promise<Response>)({ tx: 1 }));
        return next(new Request("http://localhost/rewritten", request));
      },
    });

    expect(await (await app(page("/d"), { assets })).text()).toBe("page /rewritten");

    const wrapped = await app(page("/d", { headers: { "x-wrap": "1" } }), { assets });

    expect(wrapped.status).toBe(500);
    expect(error.mock.calls[0][0].message).toBe("next() forwards a Request, not an object - to wrap it, pass a function that calls it: () => next().");
  });

  it("will resolve next with mutable headers, but a 101 as is", async () => {
    const upgrade = Object.create(Response.prototype, { status: { value: 101 } }) as Response;
    const frozen = Response.redirect("http://localhost/elsewhere", 302);
    const app = compose({
      async handle({ request, next }) {
        const reply = await next();

        if (request.headers.has("x-upgrade")) return expect(reply).toBe(upgrade), reply;

        reply.headers.set("x-handled", "1");
        return reply;
      },
    });

    const redirected = await app(page("/"), { assets: { fetch: async () => frozen } });

    expect([redirected.status, redirected.headers.get("location"), redirected.headers.get("x-handled")]).toEqual([302, "http://localhost/elsewhere", "1"]);
    expect(await app(page("/", { headers: { "x-upgrade": "1" } }), { assets: { fetch: async () => upgrade } })).toBe(upgrade);
  });

  it("will throw on a second next, and on one after handle returned", async () => {
    let late!: () => Promise<Response>;
    const app = compose({
      async handle({ request, next }) {
        late = next;

        if (request.headers.has("x-twice")) {
          await next();
          await next();
        }
      },
    });

    expect((await app(page("/", { headers: { "x-twice": "1" } }), { assets })).status).toBe(500);
    expect(error.mock.calls[0][0].message).toBe("next() runs once per request.");

    await app(page("/"), { assets });
    expect(() => late()).toThrow("next() was called after handle returned - await it inside handle.");
  });

  it("will resolve next with an error reply for a reply it cannot copy", async () => {
    const statuses: number[] = [];
    const app = compose({
      async handle({ next }) {
        statuses.push((await next()).status);
        return new Response("own");
      },
    });

    expect(await (await app(page("/"), { assets: { fetch: async () => Response.error() } })).text()).toBe("own");
    expect(statuses).toEqual([500]);
  });

  it("will throw for a return value other than a Response or nothing", async () => {
    const app = compose({ handle: (() => "hello") as never });

    expect((await app(page("/"), { assets })).status).toBe(500);
    expect(error.mock.calls[0][0].message).toBe("handle returned string - return a Response, or nothing to pass.");

    await compose({ handle: (() => null) as never })(page("/"));
    expect(error.mock.calls[1][0].message).toBe("handle returned null - return a Response, or nothing to pass.");
  });

  it("will cancel the body of a next reply it discards", async () => {
    const cancel = vi.fn();
    const body = () => new ReadableStream({ cancel });
    const app = compose({
      async handle({ request, next }) {
        const reply = await next();

        if (request.headers.has("x-throw")) throw new Error("after next");
        if (request.headers.has("x-keep")) return new Response(reply.body, reply);
        return new Response("replaced");
      },
    });
    const streamed = { fetch: async () => new Response(body()) };

    expect(await (await app(page("/"), { assets: streamed })).text()).toBe("replaced");
    await app(page("/", { headers: { "x-throw": "1" } }), { assets: streamed });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(2));

    await (await app(page("/", { headers: { "x-keep": "1" } }), { assets: streamed })).body!.cancel();
    expect(cancel).toHaveBeenCalledTimes(3);
  });

  it("will answer a thrown HttpError with its status, codec-shaped on a call", async () => {
    const app = compose({
      handle({ request }) {
        if (request.headers.has("x-redirect")) throw new Redirect("/login");
        throw new Taken("held");
      },
    }, { sidecars });

    const refused = await app(page("/"), { assets });
    const redirected = await app(page("/", { headers: { "x-redirect": "1" } }), { assets });
    const called = await app(call("add", [1, 1]));

    expect([refused.status, await refused.json()]).toEqual([409, { message: "held" }]);
    expect([redirected.status, redirected.headers.get("location")]).toEqual([302, "/login"]);
    expect([called.status, await called.json()]).toMatchObject([409, { error: "Taken", message: "held" }]);
  });

  it("will log anything else as a 500, its message shown in dev only", async () => {
    const handle = () => {
      throw new Error("no session");
    };

    expect(await (await compose({ handle })(page("/"), { assets })).json()).toEqual({ message: "Internal error." });
    expect(await (await compose({ handle }, { dev: true })(page("/"), { assets })).json()).toEqual({ message: "no session" });
    expect(await (await compose({ handle }, { sidecars })(call("add", [1, 1]))).json()).toEqual({ message: "Internal error." });
    expect(error).toHaveBeenCalledTimes(3);
  });

  it("will give handle the host's env and ctx, with stand-ins for what the host lacks", async () => {
    const host = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: { a: 1 } };
    const late = Promise.reject(new Error("late"));
    const app = compose({
      handle({ env, ctx }) {
        ctx.waitUntil(late);
        ctx.passThroughOnException();
        return Response.json({ env, props: ctx.props });
      },
    });

    expect(await (await app(page("/"), { env: { NAME: "prod" } as object, ctx: host })).json()).toEqual({ env: { NAME: "prod" }, props: { a: 1 } });
    expect(host.waitUntil).toHaveBeenCalledWith(late);
    expect(host.passThroughOnException).toHaveBeenCalled();

    expect(await (await app(page("/"))).json()).toEqual({ env: {}, props: {} });
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("waitUntil:", new Error("late")));
  });
});

describe("refuse", () => {
  it("will keep a status in 4xx or 5xx only", async () => {
    const odd = Object.assign(new HttpError("odd"), { status: 200 });

    expect(refuse(new NotFound("gone"), false).status).toBe(404);
    expect(refuse(odd, false).status).toBe(500);
    expect(await refuse("thrown", true).json()).toEqual({ message: "Internal error." });
  });
});

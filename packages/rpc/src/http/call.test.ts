import { describe, expect, it, vi } from "vitest";

import { Model } from "@expressive/mvc";

import type { Endpoint, Seats } from "../call";
import { Current, install } from "../context";
import { Cookies } from "../cookies";
import { Forbidden } from "../errors";
import { route } from "../route";
import { dispatch, failure, handler, isCall, reply, scoped, type Tier } from "./call";

const TAB = crypto.randomUUID();

function request(url: string, name: string | undefined, body: string, type = "application/json", extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { "content-type": type, "x-expressive-connection": TAB, ...extra };
  if (name) headers["x-expressive-call"] = name;
  return { method: "POST", url, headers, body };
}

function fetched({ method, url, headers, body }: ReturnType<typeof request>) {
  return new Request(`http://localhost${url}`, { method, headers, body: method === "GET" ? undefined : body });
}

async function sent(endpoints: Endpoint[], req: ReturnType<typeof request>, dev = false, seats?: Seats) {
  const response = await dispatch(fetched(req), () => endpoints, dev, seats);
  const text = await response.text();

  return { status: response.status, body: text ? JSON.parse(text) : undefined, headers: Object.fromEntries(response.headers) };
}

async function send(endpoints: Endpoint[], req: ReturnType<typeof request>, dev = false, seats?: Seats) {
  const { status, body } = await sent(endpoints, req, dev, seats);
  return { status, body };
}

describe("call dispatch", () => {
  const calls: Record<string, unknown> = {
    add: async (a: number, b: number) => a + b,
    none: async () => {},
    fail: async () => { throw new Error("Nope"); },
    value: 1,
  };
  class Limit extends Error {
    status = 409;
    constructor(public limit: number) { super(`Over ${limit}`); }
  }
  class Hard extends Limit {}
  class Strange extends Error { status = 200; }

  calls.limit = async () => { throw new Hard(3); };
  calls.strange = async () => { throw new Strange("Odd"); };

  const endpoints: Endpoint[] = [
    { pattern: ["tally"], exports: async () => ({ calls, classes: {} }) },
    { pattern: ["shared"], exports: async () => ({ calls: {}, classes: { "/shared#Limit": Limit, "/shared#Strange": Strange } }) },
  ];

  it("will reply with a call's value alone, with no connection id", async () => {
    const plain = (name: string, args: string) => {
      const { "x-expressive-connection": _, ...headers } = request("/tally", name, args).headers;
      return sent(endpoints, Object.assign(request("/tally", name, args), { headers }));
    };

    expect(await plain("add", "[1, 2]")).toEqual({ status: 200, body: { value: 3 }, headers: { "content-type": "application/json; charset=utf-8" } });
    expect((await plain("none", "[]")).body).toEqual({});
  });

  it("will reply 404 to a pull, a seat method or a pool method", async () => {
    class Tally extends Model {
      total = 0;
      async add() { return ++this.total; }
    }

    const exports = {
      calls,
      classes: {},
      seat: { fields: ["total"], methods: { "default.add": "add" } },
      pool: { "/tally#Tally": { Type: Tally, fields: ["total"], methods: { "/tally#Tally.add": "add" } } },
    };
    const twinned: Endpoint[] = [{ pattern: ["tally"], exports: async () => exports }];
    const seats: Seats = async pattern => (pattern.join("/") === "tally" ? Tally : undefined);
    const as = (name: string | undefined, extra: Record<string, string>) =>
      send(twinned, request("/tally", name, "[]", "application/json", { "x-expressive-twin": "Tally-A", ...extra }), false, seats);
    const missing = { status: 404, body: { message: "Not found." } };

    expect(await as(undefined, { "x-expressive-get": "default" })).toEqual(missing);
    expect(await as(undefined, { "x-expressive-get": "/tally#Tally" })).toEqual(missing);
    expect(await as("default.add", {})).toEqual(missing);
    expect(await as("/tally#Tally.add", {})).toEqual(missing);
    expect(await as("none", {})).toEqual({ status: 200, body: {} });
    expect(await as("none", { "x-expressive-get": "default" })).toEqual(missing);
  });

  it("will identify a call by method, name header and JSON body", () => {
    expect(isCall(fetched(request("/tally", "add", "[]")))).toBe(true);
    expect(isCall(fetched(request("/tally", undefined, "[]")))).toBe(false);
    expect(isCall(fetched(request("/tally", "add", "[]", "text/plain")))).toBe(false);
    expect(isCall(fetched(Object.assign(request("/tally", "add", "[]"), { method: "GET" })))).toBe(false);
  });

  it("will identify a pull as a call", () => {
    expect(isCall(fetched(request("/tally", undefined, "[]", "application/json", { "x-expressive-get": "default" })))).toBe(true);
  });

  it("will reply 404 alike to an unknown path, an unknown name and a non-function", async () => {
    const missing = { status: 404, body: { message: "Not found." } };

    expect(await send(endpoints, request("/nope", "add", "[]"))).toEqual(missing);
    expect(await send(endpoints, request("/tally", "subtract", "[]"))).toEqual(missing);
    expect(await send(endpoints, request("/tally", "toString", "[]"))).toEqual(missing);
    expect(await send(endpoints, request("/tally", "value", "[]"))).toEqual(missing);
  });

  it("will reply 400 to a body that is not an array of arguments", async () => {
    const bad = { status: 400, body: { message: "Expected a JSON array of arguments." } };

    expect(await send(endpoints, request("/tally", "add", "{"))).toEqual(bad);
    expect(await send(endpoints, request("/tally", "add", "{}"))).toEqual(bad);
  });

  it("will hide a thrown error's message outside development", async () => {
    expect(await send(endpoints, request("/tally", "fail", "[]"))).toEqual({ status: 500, body: { message: "Internal error." } });

    const { body } = await send(endpoints, request("/tally", "fail", "[]"), true);
    expect(body.message).toBe("Nope");
    expect(body.stack).toContain("Error: Nope");
  });

  it("will send an exported error class's id, status and fields, even from a subclass", async () => {
    expect(await send(endpoints, request("/tally", "limit", "[]"))).toEqual({
      status: 409,
      body: { error: "/shared#Limit", message: "Over 3", status: 409, limit: 3 },
    });
  });

  it("will keep a status outside 4xx and 5xx to 500", async () => {
    expect((await send(endpoints, request("/tally", "strange", "[]"))).status).toBe(500);
  });
});

describe("handler", () => {
  const endpoints: Endpoint[] = [{ pattern: ["tally"], exports: async () => ({ calls: { add: async (a: number, b: number) => a + b }, classes: {} }) }];

  it("will answer a call, from a list or a function of one", async () => {
    for (const handle of [handler(endpoints), handler(() => endpoints, { dev: true })]) {
      const response = await handle(fetched(request("/tally", "add", "[1, 2]")));
      expect(await response!.json()).toEqual({ value: 3 });
    }
  });

  it("will pass on a request that is not a call", async () => {
    expect(await handler(endpoints)(new Request("http://localhost/tally"))).toBeUndefined();
  });

  it("will answer calls only under its base, matching folders beneath it", async () => {
    const handle = handler(endpoints, { base: "/api/v1" });
    const response = await handle(fetched(request("/api/v1/tally", "add", "[1, 2]")));

    expect(await response!.json()).toEqual({ value: 3 });
    expect(await handle(fetched(request("/tally", "add", "[1, 2]")))).toBeUndefined();
    expect(await handle(fetched(request("/api/tally", "add", "[1, 2]")))).toBeUndefined();
    expect((await handle(fetched(request("/api/v1/other", "add", "[1, 2]"))))!.status).toBe(404);
  });
});

describe("handler of a tree", () => {
  install();

  class Session extends Model {
    user = "";

    protected new() {
      const token = Current.get().request.headers.get("authorization");

      if (!token) throw new Forbidden("Sign in.");

      this.user = token;
    }
  }

  class Duplicate extends Error {
    status = 409;
  }

  const api = route(() => void Session.new(), {
    whoami: async () => Session.get().user,
    claim: {
      create: async (name: string) => { throw new Duplicate(`${name} exists`); },
      fail: async () => { throw new Error("Nope"); },
      path: async () => Current.get().url.pathname,
    },
  });

  const answer = async (handle: ReturnType<typeof handler>, url: string, name: string | undefined, body = "[]", token?: string) => {
    const response = await handle(fetched(request(url, name, body, "application/json", token ? { authorization: token } : {})));
    return response && { status: response.status, body: await response.json() };
  };

  it("will answer a call at its place in the tree, behind the gates along it", async () => {
    const handle = handler(api);

    expect(await answer(handle, "/", "whoami", "[]", "ada")).toEqual({ status: 200, body: { value: "ada" } });
    expect(await answer(handle, "/claim", "path", "[]", "ada")).toEqual({ status: 200, body: { value: "/claim" } });
    expect(await answer(handle, "/", "whoami")).toEqual({ status: 403, body: { error: "http:Forbidden", message: "Sign in.", status: 403 } });
  });

  it("will send a listed error class by its id, and hide the rest outside development", async () => {
    expect(await answer(handler(api, { errors: { Duplicate } }), "/claim", "create", '["a"]', "ada")).toEqual({
      status: 409,
      body: { error: "Duplicate", message: "a exists", status: 409 },
    });
    expect(await answer(handler(api), "/claim", "create", '["a"]', "ada")).toEqual({ status: 500, body: { message: "Internal error." } });
    expect(await answer(handler(api), "/claim", "fail", "[]", "ada")).toEqual({ status: 500, body: { message: "Internal error." } });
  });

  it("will reply 404 to no call at the path, and 400 to arguments that are not an array", async () => {
    const handle = handler(api);

    expect(await answer(handle, "/claim", "missing")).toEqual({ status: 404, body: { message: "Not found." } });
    expect(await answer(handle, "/claim", undefined, "[]", "ada")).toBeUndefined();
    expect((await handle(fetched(request("/claim", undefined, "[]", "application/json", { "x-expressive-get": "1" }))))!.status).toBe(404);
    expect(await answer(handle, "/claim", "path", "{}", "ada")).toEqual({ status: 400, body: { message: "Expected a JSON array of arguments." } });
  });

  it("will answer only under its base", async () => {
    const handle = handler(api, { base: "/api" });

    expect(await answer(handle, "/api/claim", "path", "[]", "ada")).toEqual({ status: 200, body: { value: "/api/claim" } });
    expect(await answer(handle, "/claim", "path", "[]", "ada")).toBeUndefined();
  });

  it("will throw if a name in the tree is reserved", () => {
    expect(() => handler({ a: { with: async () => {} } })).toThrow("a.with is reserved for the client");
  });
});

describe("failure", () => {
  it("will reply an error as a call would, with the headers given", async () => {
    class Gone extends Error { status = 410; }
    const endpoints: Endpoint[] = [{ pattern: [], exports: async () => ({ calls: {}, classes: { "#Gone": Gone } }) }];
    const response = await failure(new Gone("Gone"), endpoints, false, { "x-a": "1" });

    expect(response.status).toBe(410);
    expect(response.headers.get("x-a")).toBe("1");
    expect(await response.json()).toEqual({ error: "#Gone", message: "Gone", status: 410 });
  });
});

describe("tier", () => {
  const add = async (a: number, b: number) => a + b;
  const endpoints: Endpoint[] = [{ pattern: ["tally"], exports: async () => ({ calls: { add }, classes: {} }) }];

  it("will let a tier take a call, given what the request resolved to", async () => {
    const tier: Tier<any> = vi.fn(async ({ pathname, exports }, fn) => async (args: unknown[]) => reply(200, { pathname, fn: fn === add, exports: !!exports, args }));
    const response = await dispatch(fetched(request("/tally", "add", "[1]")), () => endpoints, false, undefined, tier);

    expect(await response.json()).toEqual({ pathname: "/tally", fn: true, exports: true, args: [1] });
  });

  it("will reply 404 to what no tier takes, and hand it no call for a pull or an unnamed request", async () => {
    const tier = vi.fn(async () => undefined);

    expect((await dispatch(fetched(request("/tally", undefined, "[]")), () => endpoints, false, undefined, tier)).status).toBe(404);
    expect((await dispatch(fetched(request("/tally", "add", "[]", "application/json", { "x-expressive-get": "default" })), () => endpoints, false, undefined, tier)).status).toBe(404);
    expect(tier.mock.calls.map(call => (call as unknown[])[1])).toEqual([undefined, undefined]);
  });
});

describe("reply", () => {
  it("will send no body for no value", async () => {
    const response = reply(304, undefined, { "x-a": "1" });

    expect(response.status).toBe(304);
    expect(response.headers.get("x-a")).toBe("1");
    expect(response.body).toBeNull();
  });
});

describe("headers from a call", () => {
  install();

  class Session extends Cookies {
    static options = { seen: { httpOnly: false } };
    session?: string = undefined;
    seen?: string = undefined;
  }

  const calls = {
    login: async () => {
      Session.set({ session: "abc", seen: "1" });
      Current.get().setHeader("cache-control", "no-store");
      Current.get().setHeader("content-type", "text/plain");
    },
    logout: async () => {
      Session.set({ session: undefined });
      throw new Error("Signed out.");
    },
  };
  const endpoints: Endpoint[] = [{ pattern: ["auth"], exports: async () => ({ calls, classes: {} }) }];

  it("will add them to the reply, keeping the reply's own", async () => {
    const response = await dispatch(fetched(request("/auth", "login", "[]")), () => endpoints, false);

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual(["session=abc; Path=/; HttpOnly; SameSite=Lax", "seen=1; Path=/; SameSite=Lax"]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await response.json()).toEqual({});
  });

  it("will add them to a failure too", async () => {
    const response = await dispatch(fetched(request("/auth", "logout", "[]", "application/json", { cookie: "session=abc" })), () => endpoints, false);

    expect(response.status).toBe(500);
    expect(response.headers.getSetCookie()).toEqual(["session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax"]);
  });
});

describe("scoped", () => {
  install();

  class Prefs extends Cookies {
    theme?: string = undefined;
  }

  class App {
    label = "app";

    async fetch(request: Request): Promise<Response | undefined> {
      const { pathname } = new URL(request.url);

      if (pathname === "/none") return undefined;
      if (pathname === "/plain") return new Response("plain");
      if (pathname === "/again") {
        // what a call answered inside the route already carries
        Prefs.set({ theme: "dark" });
        return new Response("again", { headers: { "set-cookie": "theme=dark; Path=/; HttpOnly; SameSite=Lax" } });
      }

      Prefs.set({ theme: Prefs.get().theme === "dark" ? "light" : "dark" });
      Current.get().setHeader("cache-control", "no-store");

      return Response.json({ at: Current.get().url.pathname, label: this.label }, { headers: { "cache-control": "max-age=1" } });
    }

    scheduled() {
      return this.label;
    }
  }

  it("will run an entry's fetch in the request's scope, adding what it set to the response", async () => {
    const app = scoped(new App());
    const response = (await app.fetch(new Request("http://localhost/flip", { headers: { cookie: "theme=dark" } })))!;

    expect(await response.json()).toEqual({ at: "/flip", label: "app" });
    expect(response.headers.getSetCookie()).toEqual(["theme=light; Path=/; HttpOnly; SameSite=Lax"]);
    expect(response.headers.get("cache-control")).toBe("max-age=1");
    expect(app.scheduled()).toBe("app");
  });

  it("will pass a response through untouched when nothing was set, and nothing when there is none", async () => {
    const app = scoped(new App());
    const plain = new Request("http://localhost/plain");

    expect(await (await app.fetch(plain))!.text()).toBe("plain");
    expect(await app.fetch(new Request("http://localhost/none"))).toBeUndefined();
  });

  it("will not repeat a cookie the response already sets", async () => {
    const response = (await scoped(new App()).fetch(new Request("http://localhost/again")))!;

    expect(response.headers.getSetCookie()).toEqual(["theme=dark; Path=/; HttpOnly; SameSite=Lax"]);
  });

  it("will leave an entry without a fetch as it is", () => {
    const entry = { scheduled() {} };

    expect(scoped(entry as { fetch?: undefined })).toBe(entry);
  });
});

describe("a server the app runs", () => {
  const fresh = async () => {
    vi.resetModules();

    const { Model } = await import("@expressive/mvc");
    const { Current } = await import("../context");
    const { Cookies } = await import("../cookies");
    const { route } = await import("../route");
    const { handler, scoped } = await import("./call");

    class Session extends Cookies {
      token?: string = undefined;
    }

    class User extends Model {
      name = "";
    }

    return { Current, Session, User, route, handler, scoped };
  };

  it("will resolve Current, cookies and a gate's Models without install()", async () => {
    const { Current, Session, User, route, handler } = await fresh();
    const api = {
      auth: { login: async (token: string) => void Session.set({ token }) },
      me: route(() => void (User.new().name = Session.get().token!), {
        whoami: async () => [Current.get().url.pathname, User.get().name],
      }),
    };
    const handle = handler(api, { base: "/api" });

    const login = (await handle(fetched(request("/api/auth", "login", '["ada"]'))))!;
    const whoami = (await handle(fetched(request("/api/me", "whoami", "[]", "application/json", { cookie: "token=ada" }))))!;

    expect(login.headers.get("set-cookie")).toContain("token=ada");
    expect(await whoami.json()).toEqual({ value: ["/api/me", "ada"] });
  });

  it("will scope the app's own routes without install()", async () => {
    const { Current, scoped } = await fresh();
    const app = scoped({ fetch: async (request: Request) => new Response(Current.get().url.pathname + (request === Current.get().request ? "" : "?")) });

    expect(await (await app.fetch(new Request("http://localhost/events")))!.text()).toBe("/events");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Model } from "@expressive/mvc";
import { Current, Forbidden } from "@expressive/rpc";

import type { Api, ApiRoute, Exports } from "./api";
import { compose } from "./compose";
import { install } from "./install";

install();

const route = (path: string[], exports: Exports, index = false): ApiRoute => ({ name: `api/${path.join("/") || "index"}.ts`, path, index, load: async () => exports });

const serve = (routes: ApiRoute[], prefix = "/api") => {
  const api: Api = { prefix, routes: () => routes };
  const app = compose({}, { api, dev: true });

  return (path: string, init?: RequestInit) => app(new Request(`http://localhost${path}`, init));
};

let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  error.mockRestore();
});

describe("api routes", () => {
  it("will answer a verb on its module's path, a value as JSON and nothing as 204", async () => {
    const fetch = serve([
      route(["hello"], { GET: () => ({ hello: "world" }), DELETE: () => {} }),
      route([], { GET: () => "root" }, true),
    ]);

    expect(await (await fetch("/api/hello")).json()).toEqual({ hello: "world" });
    expect((await fetch("/api/hello", { method: "DELETE" })).status).toBe(204);
    expect(await (await fetch("/api")).text()).toBe("root");
  });

  it("will read the body and params, decoded after the match", async () => {
    const fetch = serve([
      route(["echo"], { POST: async () => ({ echo: await Current.get().json() }) }),
      route(["photo", ":id"], { GET: () => Current.get().params }),
      route(["files", "*"], { default: () => Current.get().params }),
    ]);

    expect(await (await fetch("/api/echo", { method: "POST", headers: { "content-type": "application/json" }, body: '{"a":1}' })).json()).toEqual({ echo: { a: 1 } });
    expect(await (await fetch("/api/photo/a%20b")).json()).toEqual({ id: "a b" });
    expect(await (await fetch("/api/files/a/b%2Fc")).json()).toEqual({ "*": "a/b/c" });
  });

  it("will answer HEAD by GET without a body, and list HEAD in Allow beside GET", async () => {
    const GET = vi.fn(() => "body");
    const fetch = serve([route(["item"], { GET, PUT: () => {} }), route(["other"], { POST: () => {} })]);
    const head = await fetch("/api/item", { method: "HEAD" });
    const refused = await fetch("/api/item", { method: "POST" });
    const other = await fetch("/api/other", { method: "HEAD" });

    expect([head.status, await head.text()]).toEqual([200, ""]);
    expect(GET).toHaveBeenCalledTimes(1);
    expect([refused.status, refused.headers.get("allow"), (await refused.json()).message]).toEqual([405, "GET, HEAD, PUT", "/api/item does not answer POST."]);
    expect([other.status, other.headers.get("allow")]).toEqual([405, "POST"]);
  });

  it("will answer every method on a catch-all, through a returned fetch handler too", async () => {
    const legacy = vi.fn(async (request: Request, env: unknown) => Response.json({ method: request.method, path: new URL(request.url).pathname, env }));
    const fetch = serve([route(["any"], { default: () => Current.get().request.method }), route(["legacy", "*"], { default: () => legacy })]);
    const app = compose({}, { api: { prefix: "/api", routes: () => [route(["legacy", "*"], { default: () => legacy })] } });

    expect(await (await fetch("/api/any", { method: "PATCH" })).text()).toBe("PATCH");
    expect(await (await fetch("/api/legacy/users/1", { method: "POST" })).json()).toEqual({ method: "POST", path: "/api/legacy/users/1", env: {} });
    expect(await (await app(new Request("http://localhost/api/legacy/x"), { env: { KEY: "k" } as object })).json()).toMatchObject({ env: { KEY: "k" } });
  });

  it("will answer a JSON 404 for a path no module serves, an empty segment and a folder index with only a gate", async () => {
    const fetch = serve([route(["admin"], { default: () => {} }, true), route(["hello"], { GET: () => "hi" })]);

    for (const path of ["/api/nope", "/api//hello", "/api/hello/", "/api/admin", "/api"]) {
      const reply = await fetch(path);

      expect([path, reply.status, (await reply.json()).message]).toEqual([path, 404, `No route in api/ serves ${path} - paths under /api belong to api/.`]);
    }
  });

  it("will answer 400 for a malformed escape", async () => {
    const reply = await serve([route([":id"], { GET: () => "hi" })])("/api/%E0%A4%A");

    expect([reply.status, (await reply.json()).message]).toEqual([400, "/api/%E0%A4%A has a malformed escape."]);
  });

  it("will match case-sensitively, fixed before a param before the rest, without backtracking", async () => {
    const fetch = serve([
      route(["admin"], { default: () => {} }, true),
      route(["admin", "list"], { GET: () => "list" }),
      route([":org"], { GET: () => "org" }),
      route([":org", "users"], { GET: () => "users" }),
      route(["*"], { default: () => "rest" }),
    ]);

    expect(await (await fetch("/api/admin/list")).text()).toBe("list");
    expect((await fetch("/api/admin/users")).status).toBe(404);
    expect(await (await fetch("/api/Admin/users")).text()).toBe("users");
    expect(await (await fetch("/api/acme")).text()).toBe("org");
    expect((await fetch("/api/acme/x")).status).toBe(404);
  });

  it("will serve under another prefix, and only below it", async () => {
    const fetch = serve([route(["hello"], { GET: () => "hi" })], "/base/api");

    expect(await (await fetch("/base/api/hello")).text()).toBe("hi");
    expect((await fetch("/base/apiary")).status).toBe(404);
    expect(await (await fetch("/base/apiary")).text()).toBe("Not found.");
  });

  describe("gates", () => {
    it("will run each folder's gate outermost first, with its folder's params, on matched and unmatched paths", async () => {
      const seen: unknown[] = [];
      const gate = (name: string) => () => void seen.push([name, Current.get().params]);
      const fetch = serve([
        route([], { default: gate("root") }, true),
        route([":org"], { default: gate("org") }, true),
        route([":org", "me"], { GET: () => Current.get().params }),
      ]);

      expect(await (await fetch("/api/acme/me")).json()).toEqual({ org: "acme" });
      expect((await fetch("/api/acme/nope")).status).toBe(404);
      expect(seen).toEqual([["root", {}], ["org", { org: "acme" }], ["root", {}], ["org", { org: "acme" }]]);
    });

    it("will refuse a route that exists and one that doesn't alike", async () => {
      const fetch = serve([route(["dev"], { default: () => { throw new Forbidden("Dev only."); } }, true), route(["dev", "mail"], { GET: () => "mail" })]);

      for (const path of ["/api/dev/mail", "/api/dev/nope"]) {
        const reply = await fetch(path);
        expect([reply.status, await reply.json()]).toEqual([403, { message: "Dev only." }]);
      }
    });

    it("will keep a gate's Models in context below it until the request ends", async () => {
      class Session extends Model {
        user = "";

        async new() {
          const user = Current.get().request.headers.get("x-user");
          if (!user) throw new Forbidden("Sign in.");
          this.user = user;
        }
      }

      let session: Session | undefined;
      const fetch = serve([route(["account"], { default: () => void (session = Session.new()) }, true), route(["account", "me"], { GET: () => Session.get().user })]);
      const me = await fetch("/api/account/me", { headers: { "x-user": "ada" } });

      expect(await me.text()).toBe("ada");
      expect(session!.get(null)).toBe(true);
      expect((await fetch("/api/account/me")).status).toBe(403);
    });

    it("will let a gate wrap what is below it with next", async () => {
      const fetch = serve([
        route([], { async default() {
          const reply = await Current.get().next();
          reply.headers.set("x-status", String(reply.status));
          return reply;
        } }, true),
        route(["hello"], { GET: () => "hi" }),
      ]);
      const reply = await fetch("/api/hello");

      expect([await reply.text(), reply.headers.get("x-status")]).toEqual(["hi", "200"]);
      expect((await fetch("/api/nope")).headers.get("x-status")).toBe("404");
    });
  });

  it("will answer a 500 for a module that fails to load", async () => {
    const reply = await serve([{ ...route(["hello"], {}), load: async () => { throw new Error("syntax"); } }])("/api/hello");

    expect([reply.status, (await reply.json()).message]).toEqual([500, "syntax"]);
  });

  it("will show a route's or gate's thrown message in dev, but not in a build", async () => {
    const routes = [
      route(["broken"], { GET: () => { throw new Error("no session"); } }),
      route(["gated"], { default: () => { throw new Error("gate down"); } }, true),
      route(["gated", "me"], { GET: () => "me" }),
    ];
    const built = compose({}, { api: { prefix: "/api", routes: () => routes } });

    expect(await (await serve(routes)("/api/broken")).json()).toEqual({ message: "no session" });
    expect(await (await serve(routes)("/api/gated/me")).json()).toEqual({ message: "gate down" });
    expect(await (await built(new Request("http://localhost/api/broken"))).json()).toEqual({ message: "Internal error." });
    expect(error).toHaveBeenCalledTimes(3);
  });

  it("will match a fixed name against the decoded segment, so an escape cannot skip its gate", async () => {
    const fetch = serve([
      route(["admin"], { default: () => { throw new Forbidden("Admins only."); } }, true),
      route(["admin", "me"], { GET: () => "admin" }),
      route([":tenant", "me"], { GET: () => "tenant" }),
      route(["café"], { GET: () => "café" }),
      route(["a b"], { GET: () => "a b" }),
    ]);

    expect((await fetch("/api/%61dmin/me")).status).toBe(403);
    expect(await (await fetch("/api/caf%C3%A9")).text()).toBe("café");
    expect(await (await fetch("/api/a%20b")).text()).toBe("a b");
  });

  it("will keep empty segments inside the rest of a path, but not as its first", async () => {
    const fetch = serve([route(["files", "*"], { default: () => Current.get().params })]);

    expect(await (await fetch("/api/files/a//b/")).json()).toEqual({ "*": "a//b/" });
    expect((await fetch("/api/files//a")).status).toBe(404);
  });

  it("will answer HEAD without a body on a 404, a 400, a load failure and a gate's refusal", async () => {
    const fetch = serve([
      route(["dev"], { default: () => { throw new Forbidden("Dev only."); } }, true),
      route(["dev", "mail"], { GET: () => "mail" }),
      { ...route(["broken"], {}), load: async () => { throw new Error("syntax"); } },
    ]);

    for (const [path, status] of [["/api/nope", 404], ["/api/%E0%A4%A", 400], ["/api/broken", 500], ["/api/dev/mail", 403], ["/api/dev/nope", 403]] as const) {
      const reply = await fetch(path, { method: "HEAD" });
      expect([path, reply.status, await reply.text()]).toEqual([path, status, ""]);
    }
  });

  it("will answer an index module's verbs on its own path, under its own gate", async () => {
    const seen: string[] = [];
    const fetch = serve([route(["account"], { default: () => void seen.push("gate"), GET: () => "own" }, true)]);

    expect(await (await fetch("/api/account")).text()).toBe("own");
    expect(seen).toEqual(["gate"]);
  });

  it("will dispatch only a known verb, so a method named default never runs a gate as the route", async () => {
    const gate = vi.fn();
    const fetch = serve([route(["account"], { default: gate, GET: () => "own" }, true)]);
    const reply = await fetch("/api/account", { method: "default" });

    expect([reply.status, reply.headers.get("allow")]).toEqual([405, "GET, HEAD"]);
    expect(gate).toHaveBeenCalledTimes(1);
  });
});

describe("api calls", () => {
  const callable = (path: string[], exports: Exports, calls: Record<string, string>, classes: Record<string, string> = {}, index = false): ApiRoute => ({ ...route(path, exports, index), calls, classes });

  const call = (name: string, body: unknown = []) => ({
    method: "POST",
    headers: { "content-type": "application/json", "x-expressive-call": name },
    body: JSON.stringify(body),
  });

  class Taken extends Error {
    status = 409;
  }

  it("will run the call the header names, and the verbs without it, at the same URL", async () => {
    const fetch = serve([callable(["account"], { POST: () => "verb", async rename(name: string) { return `${name}!`; } }, { r1: "rename" })]);
    const missing = await fetch("/api/account", call("nope"));
    const malformed = await fetch("/api/account", call("r1", { name: "ada" }));

    expect(await (await fetch("/api/account", call("r1", ["ada"]))).json()).toEqual({ value: "ada!" });
    expect(await (await fetch("/api/account", { method: "POST", headers: { "content-type": "application/json" }, body: "[]" })).text()).toBe("verb");
    expect([missing.status, await missing.json()]).toEqual([404, { message: "Not found." }]);
    expect([malformed.status, await malformed.json()]).toEqual([400, { message: "Expected a JSON array of arguments." }]);
  });

  it("will run the folder gates before a call, keeping their Models in context, and let a gate wrap it with next", async () => {
    class Session extends Model {
      user = "";

      async new() {
        const user = Current.get().request.headers.get("x-user");
        if (!user) throw new Forbidden("Sign in.");
        this.user = user;
      }
    }

    const fetch = serve([
      route([], { async default() {
        const reply = await Current.get().next();
        reply.headers.set("x-wrapped", String(reply.status));
        return reply;
      } }, true),
      route(["account"], { default: () => void Session.new() }, true),
      callable(["account", "me"], { async who() { return Session.get().user; } }, { who: "who" }),
    ]);
    const signed = await fetch("/api/account/me", { ...call("who"), headers: { ...call("who").headers, "x-user": "ada" } });
    const refused = await fetch("/api/account/me", call("who"));

    expect([await signed.json(), signed.headers.get("x-wrapped")]).toEqual([{ value: "ada" }, "200"]);
    expect([refused.status, await refused.json(), refused.headers.get("x-wrapped")]).toEqual([403, expect.objectContaining({ message: "Sign in." }), "403"]);
  });

  it("will keep a call's error class on its reply, and answer a failure to load as a call's 500", async () => {
    const fetch = serve([callable(["shop"], { async buy() { throw new Taken("Sold out."); }, Taken }, { buy: "buy" }, { "/api/shop#Taken": "Taken" })]);
    const broken = compose({}, { api: { prefix: "/api", routes: () => { throw new Error("misnamed"); } }, dev: true });
    const taken = await fetch("/api/shop", call("buy"));
    const failed = await broken(new Request("http://localhost/api/shop", call("buy")));

    expect([taken.status, await taken.json()]).toEqual([409, { error: "/api/shop#Taken", message: "Sold out.", status: 409 }]);
    expect([failed.status, (await failed.json()).message]).toEqual([500, "misnamed"]);
  });

  it("will match a call's route by its decoded path, under a gate whose folder needs encoding too", async () => {
    const seen: string[] = [];
    const fetch = serve([
      route(["café"], { default: () => void seen.push("gate") }, true),
      callable(["café", "my notes"], { async list() { return "notes"; } }, { list: "list" }),
      callable(["(x)"], { async x() { return "x"; } }, { x: "x" }),
    ]);

    expect(await (await fetch("/api/caf%C3%A9/my%20notes", call("list"))).json()).toEqual({ value: "notes" });
    expect(await (await fetch("/api/(x)", call("x"))).json()).toEqual({ value: "x" });
    expect((await fetch("/api/caf%C3%A9/%E0%A4%A", call("list"))).status).toBe(404);
    expect(seen).toEqual(["gate"]);
  });

  it("will answer a call under another prefix, and none for a route with only error classes", async () => {
    const fetch = serve([callable(["shop"], { async buy() { return 1; } }, { buy: "buy" }), { ...route(["plain"], { POST: () => "verb", Taken }), classes: { Taken: "Taken" } }], "/base/api");

    expect(await (await fetch("/base/api/shop", call("buy"))).json()).toEqual({ value: 1 });
    expect((await fetch("/base/api/plain", call("buy"))).status).toBe(404);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Model } from "@expressive/mvc";
import { Current, Forbidden } from "@expressive/rpc";

import { problems, verifyApi, type Api, type ApiRoute, type Exports } from "./api";
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

  it("will refuse a module that breaks the route rules as it loads, with a 500 naming it", async () => {
    const reply = await serve([route(["hello"], { helper: () => {} })])("/api/hello");

    expect([reply.status, (await reply.json()).message]).toEqual([500, "api/hello.ts: `helper` is not a route export - export GET, POST, PUT, PATCH, DELETE, OPTIONS or a default, and keep helpers outside api/. No handler - export GET, POST, PUT, PATCH, DELETE, OPTIONS or a default."]);
  });
});

describe("problems", () => {
  it("will name exports a route does not read, reserving api/index.ts's", () => {
    expect(problems(["GET", "Get"], false, false, false)).toEqual(["`Get` is not a route export - export GET, POST, PUT, PATCH, DELETE, OPTIONS or a default, and keep helpers outside api/."]);
    expect(problems(["default", "spec"], true, true, false)).toEqual(["`spec` - api/index.ts's other exports are reserved; export only verbs and a default gate."]);
    expect(problems(["default", "spec"], true, false, false)).toEqual(["`spec` is not a route export - export GET, POST, PUT, PATCH, DELETE, OPTIONS or a default, and keep helpers outside api/."]);
  });

  it("will refuse a class gate, a catch-all beside verbs and a module with no handler, but pass a gate alone", () => {
    expect(problems(["default"], true, false, true)).toEqual(["A folder's default is its gate - a function, not a class: export default () => { Session.new() }"]);
    expect(problems(["default", "GET"], false, false, false)).toEqual(["A default answers every method - export it or verbs, not both."]);
    expect(problems([], false, false, false)).toEqual(["No handler - export GET, POST, PUT, PATCH, DELETE, OPTIONS or a default."]);
    expect(problems([], true, false, false)).toEqual(["No handler - export GET, POST, PUT, PATCH, DELETE, OPTIONS or a default."]);
    expect(problems(["default"], true, false, false)).toEqual([]);
    expect(problems(["default", "GET"], true, false, false)).toEqual([]);
  });
});

describe("verifyApi", () => {
  it("will throw for a class gate, imported or not, and a handler that is not a function", () => {
    class Session extends Model {}

    expect(() => verifyApi(route(["a"], { default: Session }, true), { default: Session })).toThrow("api/a.ts: A folder's default is its gate - a function, not a class");
    expect(() => verifyApi(route(["a"], {}), { GET: "hi" })).toThrow("api/a.ts: `GET` is not a function.");
    expect(() => verifyApi(route(["a"], {}), { GET: () => {} })).not.toThrow();
  });
});

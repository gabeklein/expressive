import { describe, expect, it, vi } from "vitest";

import { route } from "../route";
import { addressOf, Calls, groupLines, locate, Manifest, type Exposed } from "./manifest";
import type { Leaf, Tree } from "./surface";

const DIR = "/app/api";
const at = (file: string) => locate(DIR, file);

function exposed(file: string, fields: Partial<Exposed> = {}): Exposed {
  return { ...at(file)!, calls: [], errors: [], ...fields };
}

describe("locate", () => {
  it("will place a module in its folder's layer, an index as the folder itself", () => {
    expect(at("/app/api/todos.ts")).toEqual({ file: "/app/api/todos.ts", pattern: [], module: "todos" });
    expect(at("/app/api/admin/users.tsx")).toEqual({ file: "/app/api/admin/users.tsx", pattern: ["admin"], module: "users" });
    expect(at("/app/api/admin/index.js")).toEqual({ file: "/app/api/admin/index.js", pattern: ["admin"], module: "" });
  });

  it("will not place a module outside the folder, or a file that is not a script", () => {
    expect(at("/app/src/main.ts")).toBeUndefined();
    expect(at("/app/apis/todos.ts")).toBeUndefined();
    expect(at("/app/api/data.json")).toBeUndefined();
  });

  it("will throw for a module under a dynamic folder", () => {
    expect(() => at("/app/api/[id]/todos.ts")).toThrow("api/[id]/todos.ts is under [id] - folders are static path segments.");
  });
});

describe("ids", () => {
  const todos = at("/app/api/todos.ts")!;
  const root = at("/app/api/index.ts")!;
  const users = at("/app/api/admin/users.ts")!;

  it("will name calls readably, an index's by export alone, and classes by folder", () => {
    const manifest = new Manifest();

    expect(manifest.callId(todos, "list")).toBe("todos:list");
    expect(manifest.callId(root, "ping")).toBe("ping");
    expect(manifest.callId(users, "list")).toBe("users:list");
    expect(manifest.classId(todos, "Payment")).toBe("/#todos:Payment");
    expect(manifest.classId(users, "Banned")).toBe("/admin#users:Banned");
  });

  it("will hash every id with a salt", () => {
    const a = new Manifest("a");
    const b = new Manifest("b");

    expect(a.callId(todos, "list")).toMatch(/^[\w-]{16}$/);
    expect(a.classId(todos, "Payment")).toMatch(/^[\w-]{16}$/);
    expect(a.callId(todos, "list")).not.toBe(a.callId(users, "list"));
    expect(a.callId(todos, "list")).not.toBe(b.callId(todos, "list"));
  });
});

describe("stub", () => {
  it("will export each call through the shared client, and define each error under its parent", () => {
    const manifest = new Manifest();
    const stub = manifest.stub(exposed("/app/api/todos.ts", {
      calls: ["list"],
      errors: [
        { name: "Over" },
        { name: "Payment", parent: { id: "http:HttpError" } },
        { name: "Pro", parent: { file: "/app/api/todos.ts", name: "Payment" } },
      ],
    }), at);

    expect(stub).toBe([
      `import { call, define } from "@expressive/rpc";`,
      `const at = "/";`,
      `export const list = (...args) => call(at, "todos:list", args);`,
      `export const Over = define("/#todos:Over", "Over");`,
      `export const Payment = define("/#todos:Payment", "Payment", "http:HttpError");`,
      `export const Pro = define("/#todos:Pro", "Pro", "/#todos:Payment");`,
      "",
    ].join("\n"));
  });

  it("will import another module first when a parent is defined there", () => {
    const manifest = new Manifest();
    const stub = manifest.stub(exposed("/app/api/admin/users.ts", {
      errors: [
        { name: "Banned", parent: { file: "/app/api/admin/errors.ts", name: "Denied" } },
        { name: "Locked", parent: { file: "/app/api/admin/errors.ts", name: "Denied" } },
        { name: "Late", parent: { file: "/app/api/errors.ts", name: "Billing" } },
      ],
    }), at);

    expect(stub).toContain(`import "./errors.ts";\nimport "../errors.ts";\nconst at = "/admin";`);
    expect(stub).toContain(`define("/admin#users:Banned", "Banned", "/admin#errors:Denied")`);
    expect(stub).toContain(`define("/admin#users:Late", "Late", "/#errors:Billing")`);
  });
});

describe("stub for a host", () => {
  it("will import from the host's runtime, with its own path", () => {
    const stub = new Manifest().stub(exposed("/app/api/todos.ts", { calls: ["list"], errors: [{ name: "Over" }] }), at, {
      from: "/runtime.ts",
      at: ["blog", ":slug"],
    });

    expect(stub).toBe([
      `import { call, define } from "/runtime.ts";`,
      `const at = ["blog",":slug"];`,
      `export const list = (...args) => call(at, "todos:list", args);`,
      `export const Over = define("/#todos:Over", "Over");`,
      "",
    ].join("\n"));
  });
});

describe("stub", () => {
  it("will stub each call through the shared client's call, at the folder's path, and each error class by define", () => {
    const stub = new Manifest().stub(exposed("/app/api/admin/todos.ts", { calls: ["list"], errors: [{ name: "Late", parent: { file: "/app/api/errors.ts", name: "Billing" } }, { name: "Over" }] }), at);

    expect(stub).toContain(`import { call, define } from "@expressive/rpc";`);
    expect(stub).toContain(`import "../errors.ts";`);
    expect(stub).toContain(`const at = "/admin";\nexport const list = (...args) => call(at, "todos:list", args);`);
    expect(stub).toContain(`export const Late = define("/admin#todos:Late", "Late", "/#errors:Billing");\nexport const Over = define("/admin#todos:Over", "Over");`);
  });
});

describe("calls", () => {
  const TODOS = exposed("/app/api/todos.ts", { calls: ["list"], errors: [{ name: "Over", parent: { id: "http:HttpError" } }] });
  const ROOT = exposed("/app/api/index.ts", { calls: ["ping"] });
  const USERS = exposed("/app/api/admin/users.ts", { calls: ["ban"] });

  function calls(...modules: Exposed[]) {
    const manifest = new Calls();
    for (const module of modules) manifest.modules.set(module.file, module);
    return manifest;
  }

  it("will address a call by its folders and module, an index by its folder", () => {
    expect(addressOf(TODOS)).toEqual(["todos"]);
    expect(addressOf(ROOT)).toEqual([]);
    expect(addressOf(USERS)).toEqual(["admin", "users"]);
  });

  it("will name a call and an error class as exported, sealing only a call's under a salt", () => {
    expect(calls().callId(TODOS, "list")).toBe("list");
    expect(calls().classId(TODOS, "Over")).toBe("Over");
    expect(new Calls("salt").callId(TODOS, "list")).toMatch(/^[\w-]{16}$/);
    expect(new Calls("salt").callId(TODOS, "list")).not.toBe(new Calls("salt").callId(USERS, "list"));
    expect(new Calls("salt").classId(TODOS, "Over")).toBe("Over");
  });

  it("will stub a module as members of the shared client's tree", () => {
    const stub = calls().stub(USERS, at, { at: "/api/admin/users" });

    expect(stub).toContain(`import { api, define } from "@expressive/rpc";`);
    expect(stub).toContain("const at = api.api.admin.users;\nexport const ban = at.ban;");
    expect(calls().stub(ROOT, at)).toContain("const at = api;\nexport const ping = at.ping;");
    expect(new Calls("salt").stub(TODOS, at, { at: "/my-api/todos" })).toMatch(/const at = api\["my-api"\]\.todos;\nexport const list = at(\.[\w$]+|\["[\w-]+"\]);/);
    expect(calls().stub(TODOS, at)).toContain(`export const Over = define("Over", "Over", "http:HttpError");`);
  });

  it("will throw if a module, folder or call takes a reserved name", () => {
    expect(() => calls().stub(exposed("/app/api/with.ts", { calls: ["a"] }), at)).toThrow(`with.ts: "with" is reserved for the client - name it otherwise.`);
    expect(() => calls().stub(exposed("/app/api/then/index.ts", { calls: ["a"] }), at)).toThrow(`then/index.ts: "then" is reserved`);
    expect(() => calls().stub(exposed("/app/api/a.ts", { calls: ["with"] }), at)).toThrow(`a.ts: "with" is reserved`);
  });

  it("will throw if two modules export an error class by one name", () => {
    const other = exposed("/app/api/admin/users.ts", { errors: [{ name: "Over" }] });

    expect(() => calls(TODOS).stub(other, at)).toThrow("admin/users.ts and todos.ts both export an error class Over - rename one where it is exported.");
    expect(calls(TODOS).stub(TODOS, at)).toContain(`define("Over"`);
  });

  it("will throw if a module and a folder, or a call and a path, take one name", () => {
    const folder = exposed("/app/api/todos/index.ts", { calls: ["x"] });
    const call = exposed("/app/api/index.ts", { calls: ["admin"] });

    expect(() => calls(TODOS, folder).layout(new Map())).toThrow("/todos is both todos/ and todos.ts - rename one.");
    expect(() => calls(folder, TODOS).layout(new Map())).toThrow("/todos is both todos/ and todos.ts - rename one.");
    expect(() => calls(call, USERS).layout(new Map())).toThrow("index.ts: admin() and /admin share a name - rename one.");
  });

  it("will write the tree as a module, a route per gated folder and a group per module", () => {
    const entry = calls(TODOS, ROOT, USERS).source([at("/app/api/index.ts")!, at("/app/api/admin/index.ts")!], "/api");

    expect(entry).toContain(`import { handler, route } from "@expressive/rpc/http";`);
    expect(entry).toContain(`import * as m0 from "/app/api/todos.ts";\nimport * as m1 from "/app/api/index.ts";\nimport * as m2 from "/app/api/admin/users.ts";\nimport * as m3 from "/app/api/admin/index.ts";`);
    expect(entry).toContain(`verify("todos.ts", { calls: {}, classes: { "Over": m0.Over } });\nconst errors = { "Over": m0.Over };`);
    expect(entry).toContain(
      `const api = route(m1.default, {\n  "ping": m1.ping,\n  "todos": {\n    "list": m0.list,\n  },\n  "admin": route(m3.default, {\n    "users": {\n      "ban": m2.ban,\n    },\n  }),\n});`,
    );
    expect(entry).toContain(`export const handle = handler(api, { errors, base: "/api" });`);
    expect(calls().source([])).toContain(`const api = {};\n\nexport const handle = handler(api, { errors });`);
  });

  it("will build the same tree from loaded modules, with their error classes", async () => {
    class Over extends Error {}
    const list = async () => [];
    const ban = async () => {};
    const ping = async () => "pong";
    const gate = () => {};
    const modules: Record<string, Record<string, unknown>> = {
      "/app/api/todos.ts": { list, Over },
      "/app/api/index.ts": { ping },
      "/app/api/admin/users.ts": { ban },
    };
    const verify = vi.fn();
    const { tree, errors } = await calls(TODOS, ROOT, USERS).build(new Map([["admin", async () => gate]]), async file => modules[file], route as never, verify);

    expect(tree).toEqual({ ping, todos: { list }, admin: { users: { ban } } });
    expect(Object.getOwnPropertySymbols(tree.admin)).toHaveLength(1);
    expect(errors).toEqual({ Over });
    expect(verify).toHaveBeenCalledWith("/app/api/todos.ts", { calls: {}, classes: { Over } });
  });
});

describe("groups", () => {
  it("will add each group as an object and each leaf as an export, from the stubs of the modules defining them", () => {
    const search = { file: "/app/api/claim/search.ts", name: "search" };
    const tree = new Map<string, Tree | Leaf>([
      ["claim", new Map<string, Tree | Leaf>([["search", search], ["create", { file: "/app/api/claim/search.ts", name: "create" }], ["empty", new Map()]])],
      ["attorney", new Map([["search", { file: "/app/api/attorney/search.ts", name: "search" }]])],
      ["findAll", search],
    ]);

    expect(groupLines("/app/api/index.ts", tree)).toEqual([
      `import { search as t0, create as t1 } from "./claim/search.ts";`,
      `import { search as t2 } from "./attorney/search.ts";`,
      `const g0 = { "search": t0, "create": t1, "empty": {} };`,
      `const g1 = { "search": t2 };`,
      `export { g0 as "claim", g1 as "attorney", t0 as "findAll" };`,
    ]);
  });
});

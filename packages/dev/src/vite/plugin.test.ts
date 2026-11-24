import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer, createServerModuleRunner, optimizeDeps, resolveConfig, type InlineConfig, type ViteDevServer } from "vite";
import { client, Current, HttpError } from "@expressive/rpc";

import { clientBuild, serverBuild } from "./build";
import { expressive } from "./plugin";

const PAGE = "export function Page(){ return <h1>hi</h1> }";
const TAB = crypto.randomUUID();
const PACKAGES = fileURLToPath(new URL("../../../", import.meta.url));

const SOURCES: InlineConfig["resolve"] = {
  alias: [
    { find: /^@expressive\/([^/]+)$/, replacement: `${PACKAGES}$1/src` },
    { find: /^@expressive\/([^/]+)\/(.+)$/, replacement: `${PACKAGES}$1/src/$2` },
  ],
};

beforeAll(async () => {
  (globalThis as any).hostMvc = await import("@expressive/mvc");
});

describe("vite host", () => {
  const dirs: string[] = [];
  const servers: ViteDevServer[] = [];

  afterEach(async () => {
    while (servers.length) await servers.pop()!.close();
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  function project(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), "host-"));
    dirs.push(root);

    for (const [path, src] of Object.entries(files)) {
      const full = join(root, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, src);
    }

    return root;
  }

  async function serve(root: string, host = expressive(), resolve = SOURCES) {
    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [host],
      resolve,
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { watch: null },
    });
    servers.push(server);
    return server;
  }

  it("serves the shell with the mount point and the virtual entry", async () => {
    const server = await serve(project({ "app/index.tsx": PAGE }));
    const html = await server.transformIndexHtml("/", "<html><body></body></html>");

    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('<script type="module" src="/.expressive/main.tsx"></script>');
  });

  it("routed project: entry mounts the generated router module on @expressive/dom", async () => {
    const server = await serve(project({ "app/index.tsx": PAGE, "app/blog/[slug].tsx": PAGE }));

    const main = await server.transformRequest("/.expressive/main.tsx");
    expect(main?.code).toContain("dev/src/index");
    expect(main?.code).toContain("/.expressive/routes.tsx");

    const routes = await server.transformRequest("/.expressive/routes.tsx");
    expect(routes?.code).toContain("/app/index.tsx");
    expect(routes?.code).toContain('to: ":slug"');
    expect(routes?.code).toMatch(/dev\/src\/jsx-dev-runtime/);
  });

  it("will not scan specs, tests or sidecars beside routes for dependencies", async () => {
    const server = await serve(project({ "app/index.tsx": PAGE, "app/index.spec.ts": "import '@playwright/test';" }));
    expect(server.config.optimizeDeps.entries).toEqual(["app/**/*.{ts,tsx,js,jsx}", "!app/**/*.{spec,test}.*", "!app/**/remote.*", "!app/**/remote/**"]);
  });

  it("single-file project: entry mounts app.tsx directly", async () => {
    const server = await serve(project({ "app.tsx": "export default () => <h1>hi</h1>" }));

    const main = await server.transformRequest("/.expressive/main.tsx");
    expect(main?.code).toContain("/app.tsx");
    expect(main?.code).not.toContain("routes.tsx");
  });

  it("reads index.ts as the config on the module runner", async () => {
    const host = expressive();
    await serve(project({ "app/index.tsx": PAGE, "index.ts": "export default { port: 0 };" }), host);

    expect(await host.api!.config()).toEqual({ port: 0 });
  });

  it("will share linked Expressive packages between the host and the module runner", async () => {
    const root = project({
      "app/index.tsx": PAGE,
      "probe.ts": 'export { Model } from "@expressive/mvc";',
      "linked/mvc/package.json": JSON.stringify({ name: "@expressive/mvc", type: "module", exports: "./index.js" }),
      "linked/mvc/index.js": "export class Model {}",
    });
    mkdirSync(join(root, "node_modules/@expressive"), { recursive: true });
    symlinkSync(join(root, "linked/mvc"), join(root, "node_modules/@expressive/mvc"), "dir");

    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [expressive()],
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    servers.push(server);

    const runner = createServerModuleRunner(server.environments.ssr);
    const { Model } = await runner.import(join(root, "probe.ts"));
    await runner.close();

    expect(Model).toBe(createRequire(join(root, "index.js"))("@expressive/mvc").Model);
  });

  const SIDECAR = `
    export class Over extends Error { status = 409 }
    export async function add(a: number, b: number) { if (a > 9) throw new Over("Too big"); return a + b }
  `;

  it("will serve a sidecar to the browser as a stub of its calls", async () => {
    const root = project({ "app/index.tsx": PAGE, "app/tally/index.tsx": "import { add } from './remote'; export const Page = () => add", "app/tally/remote.ts": SIDECAR });
    const server = await serve(root);

    await server.transformRequest("/app/tally/index.tsx");
    const stub = (await server.transformRequest("/app/tally/remote.ts"))?.code;

    expect(stub).toContain('const at = ["tally"]');
    expect(stub).toContain('call(at, "add", args)');
    expect(stub).toContain('define("/tally#Over", "Over")');
    expect(stub).not.toContain("a + b");
  });

  it("will stub a sidecar in a project reached through a symlink", async () => {
    const real = project({ "app/index.tsx": PAGE, "app/tally/index.tsx": "import { add } from './remote'; export const Page = () => add", "app/tally/remote.ts": SIDECAR });
    const link = join(mkdtempSync(join(tmpdir(), "link-")), "app");
    dirs.push(dirname(link));
    symlinkSync(real, link, "dir");

    const server = await serve(link);
    await server.transformRequest("/app/tally/index.tsx");

    expect((await server.transformRequest("/app/tally/remote.ts"))?.code).not.toContain("a + b");
  });

  it("will not crawl sidecars during dependency discovery", async () => {
    const root = project({
      "app/index.ts": "export const Page = () => null",
      "app/tally/index.ts": "import 'client-dep'; import { add } from './remote'; export const Page = () => add",
      "app/tally/remote.ts": "import { db } from 'server-only-dep'; export async function add() { return db }",
      "node_modules/client-dep/package.json": `{ "name": "client-dep", "type": "module", "main": "index.js" }`,
      "node_modules/client-dep/index.js": "export default 1;",
    });
    const config = await resolveConfig({ root, configFile: false, logLevel: "silent", plugins: [expressive()], resolve: SOURCES }, "serve");

    expect((await optimizeDeps(config, true)).optimized).toHaveProperty("client-dep");
  });

  it("will throw if client code imports a server-only name, the host adapter or the plumbing, but not server code", async () => {
    const server = await serve(project({
      "app/index.tsx": 'import { Current } from "@expressive/rpc"; export const Page = () => Current',
      "app/host.tsx": 'import { toNode } from "@expressive/rpc/http"; export const Page = () => toNode',
      "app/plumbing.tsx": 'import { within } from "@expressive/rpc/protocol"; export const Page = () => within',
      "app/ok.tsx": 'import { NotFound } from "@expressive/rpc"; export const Page = () => NotFound',
      "app/doc.tsx": '/** Server code reads `import { Current } from "@expressive/rpc"`. */\nexport const Page = () => <p>doc</p>',
    }));

    await expect(server.transformRequest("/app/index.tsx")).rejects.toThrow("app/index.tsx imports Current from @expressive/rpc, which only its server build exports.");
    await expect(server.transformRequest("/app/host.tsx")).rejects.toThrow("app/host.tsx imports @expressive/rpc/http, the host adapter - only a server entry uses it.");
    await expect(server.transformRequest("/app/plumbing.tsx")).rejects.toThrow("app/plumbing.tsx imports @expressive/rpc/protocol, server plumbing - only a server or host module uses it.");
    expect((await server.transformRequest("/app/ok.tsx"))?.code).toContain("NotFound");
    expect((await server.transformRequest("/app/doc.tsx"))?.code).toContain("doc");
    expect((await server.environments.ssr.transformRequest("/app/index.tsx"))?.code).toContain("Current");
    expect((await server.environments.ssr.transformRequest("/app/host.tsx"))?.code).toContain("toNode");
    expect((await server.environments.ssr.transformRequest("/app/plumbing.tsx"))?.code).toContain("within");
  });

  it("will guard only scripts that mention @expressive/rpc", async () => {
    const server = await serve(project({ "app/index.tsx": PAGE, "app/notes.json": `{ "server": "import { Current } from \\"@expressive/rpc\\";" }` }));

    expect((await server.transformRequest("/app/notes.json"))?.code).toContain("import { Current } from");
  });

  it("will throw if a module outside its folder imports a sidecar", async () => {
    const root = project({ "app/index.tsx": "import { add } from './tally/remote'; export const Page = () => add", "app/tally/remote.ts": SIDECAR });
    const server = await serve(root);

    await expect(server.transformRequest("/app/index.tsx")).rejects.toThrow("only modules in app/tally/ and below may call it");
  });

  const HOST = 'import { Model } from "@expressive/mvc";';

  function hostMvc(root: string): InlineConfig["resolve"] {
    const shim = join(root, "host-mvc.ts");
    const names = Object.keys((globalThis as any).hostMvc).filter(name => name !== "default");
    writeFileSync(shim, `export const { ${names.join(", ")} } = (globalThis as any).hostMvc;`);

    return { alias: [{ find: /^@expressive\/mvc$/, replacement: shim }, ...(SOURCES!.alias as any[])] };
  }

  const SEAT = `
    ${HOST}
    export default class Tally extends Model {
      static ttl = 60;
      total = 0;
      async add(by: number) { return (this.total += by); }
    }
    export async function peek() { return Tally.get().total; }
  `;

  it("will serve a remote default to the browser as a twin of its methods", async () => {
    const root = project({ "app/index.tsx": PAGE, "app/tally/index.tsx": "import Tally from './remote'; export const Page = () => Tally", "app/tally/remote.ts": SEAT });
    const server = await serve(root);

    const stub = (await server.transformRequest("/app/tally/remote.ts"))?.code;
    expect(stub).toContain('export default twin(at, { "add": "default.add" }, ["total"], "Tally")');
    expect(stub).not.toContain("this.total");
  });

  it("will twin the methods a seat inherits through imports", async () => {
    const root = project({
      "app/index.tsx": PAGE,
      "app/lib/counter.ts": `${HOST} export class Counter extends Model { count = 0; async increment() { return ++this.count; } protected async secret() {} }`,
      "app/tally/remote.ts": `import { Counter } from "../lib/counter"; export default class Tally extends Counter { async add(by: number) { return by; } }`,
    });
    const server = await serve(root);

    const stub = (await server.transformRequest("/app/tally/remote.ts"))?.code;
    expect(stub).toMatch(/export default twin\(at, \{\s*"add": "default\.add",\s*"increment": "default\.increment"\s*\}, \["count"\], "Tally"\)/);
    expect(stub).not.toContain("secret");
  });

  it("will throw if a seat's base cannot be followed", async () => {
    const root = project({ "app/index.tsx": PAGE, "app/tally/remote.ts": `const mixin = (B: any) => B; ${HOST} export default class Tally extends mixin(Model) {}` });
    const server = await serve(root);

    await expect(server.transformRequest("/app/tally/remote.ts")).rejects.toThrow("Tally extends an expression");
  });

  it("will let the route tree provide a folder's twin", async () => {
    const server = await serve(project({ "app/index.tsx": PAGE, "app/tally/index.tsx": PAGE, "app/tally/remote.ts": SEAT }));

    const routes = await server.transformRequest("/.expressive/routes.tsx");
    expect(routes?.code).toContain("app/tally/remote.ts");

    const stub = await server.transformRequest("/app/tally/remote.ts");
    expect(stub?.code).toContain("export default twin(");
  });

  it("will call a seat's methods on the instance its folder holds", async () => {
    const root = project({ "app/index.tsx": PAGE, "app/tally/remote.ts": SEAT });
    const server = await serve(root, expressive(), hostMvc(root));
    await server.transformRequest("/app/tally/remote.ts");
    await server.listen(0);

    const post = async (headers: Record<string, string>, body = "[]") => (await fetch(new URL("/tally", server.resolvedUrls!.local[0]), {
      method: "POST",
      headers: { "content-type": "application/json", "x-expressive-connection": TAB, ...headers },
      body,
    })).json();

    const twin = { "x-expressive-twin": "Tally-A" };

    expect(await post({ "x-expressive-get": "default", ...twin })).toEqual({ frame: { "Tally-A": { patch: { total: 0 }, version: expect.any(String) } } });
    expect(await post({ "x-expressive-call": "default.add", ...twin }, "[2]")).toEqual({ value: 2, frame: { "Tally-A": { patch: { total: 2 }, version: expect.any(String) } } });
    expect(await post({ "x-expressive-call": "default.add", ...twin }, "[3]")).toEqual({ value: 5, frame: { "Tally-A": { patch: { total: 5 }, version: expect.any(String) } } });
    expect(await post({ "x-expressive-call": "peek" })).toEqual({ value: 5, frame: {} });
  });

  it("will seat a folder's default for calls below it, imported by the client or not", async () => {
    const root = project({
      "app/index.tsx": PAGE,
      "app/remote.ts": `${HOST} export default class Site extends Model { static ttl = 60; name = "site"; }`,
      "app/tally/remote.ts": `import Site from "../remote"; export async function site() { return Site.get().name; }`,
    });
    const server = await serve(root, expressive(), hostMvc(root));
    await server.transformRequest("/app/tally/remote.ts");
    await server.listen(0);

    const res = await fetch(new URL("/tally", server.resolvedUrls!.local[0]), {
      method: "POST",
      headers: { "content-type": "application/json", "x-expressive-connection": TAB, "x-expressive-call": "site" },
      body: "[]",
    });

    expect(await res.json()).toEqual({ value: "site", frame: {} });
  });

  const OWNER = `
    ${HOST}
    class Line extends Model {
      qty = 1;
      async bump(by: number) { return (this.qty += by); }
    }
    export default class Order extends Model {
      static ttl = 60;
      line = new Line();
      async reset() { this.line = new Line(); }
    }
  `;

  it("will twin a seat's owned child, its methods named by their path", async () => {
    const root = project({ "app/index.tsx": PAGE, "app/order/remote.ts": OWNER });
    const server = await serve(root);

    const stub = (await server.transformRequest("/app/order/remote.ts"))?.code;
    expect(stub).toContain('export default twin(at, { "reset": "default.reset" }, ["line"], "Order", undefined, { "line": {');
    expect(stub).toMatch(/"name": "Line",\s*"fields": \["qty"\],\s*"methods": \{\s*"bump": "default\.line\.bump"\s*\}/);
  });

  it("will call a child's method on the module runner, framing the child under its path", async () => {
    const root = project({ "app/index.tsx": PAGE, "app/order/remote.ts": OWNER });
    const server = await serve(root, expressive(), hostMvc(root));
    await server.transformRequest("/app/order/remote.ts");
    await server.listen(0);

    const post = async (headers: Record<string, string>, body = "[]") => (await fetch(new URL("/order", server.resolvedUrls!.local[0]), {
      method: "POST",
      headers: { "content-type": "application/json", "x-expressive-connection": TAB, "x-expressive-twin": "Order-A", ...headers },
      body,
    })).json();

    const { frame } = await post({ "x-expressive-get": "default" });

    expect(frame).toEqual({
      "Order-A": { patch: { line: { $child: expect.any(String) } }, version: expect.any(String) },
      "Order-A.line": { patch: { qty: 1 }, version: expect.any(String) },
    });
    expect(await post({ "x-expressive-call": "default.line.bump", "if-none-match": frame["Order-A"].version }, "[2]")).toEqual({
      value: 3,
      frame: { "Order-A.line": { patch: { qty: 3 }, version: expect.any(String) } },
    });
  });

  it("will throw if a sidecar exports what the client cannot call", async () => {
    const root = project({ "app/index.tsx": PAGE, "app/tally/index.tsx": "import { add } from './remote'; export const Page = () => add", "app/tally/remote.ts": "export const add = 1" });
    const server = await serve(root);

    await expect(server.transformRequest("/app/tally/remote.ts")).rejects.toThrow("add is neither an async function nor an Error subclass");
  });

  const POOLED = `
    ${HOST}
    export class Cart extends Model {
      items = 0;
      async add() { return ++this.items; }
    }
    export class Over extends Error {}
  `;

  it("will serve an exported Model class to the browser as a twin built per use", async () => {
    const root = project({ "app/index.tsx": PAGE, "app/shop/index.tsx": "import { Cart } from './remote'; export const Page = () => Cart", "app/shop/remote.ts": POOLED });
    const server = await serve(root);

    const stub = (await server.transformRequest("/app/shop/remote.ts"))?.code;
    expect(stub).toContain('export const Cart = twin(at, { "add": "/shop#Cart.add" }, ["items"], "Cart", "/shop#Cart")');
    expect(stub).toContain('export const Over = define("/shop#Over", "Over")');

    const runtime = (await server.transformRequest("/.expressive/call.ts"))?.code;
    expect(runtime).toMatch(/import \{ Route \} from "[^"]*dev\/src\/index[^"]*"/);
  });

  it("will serve an exported subclass of an http error to the browser as an error, not a twin", async () => {
    const remote = `import { HttpError } from "@expressive/rpc";
      export class Payment extends HttpError { status = 402; }
      export async function buy() { throw new Payment("upgrade"); }`;
    const root = project({ "app/index.tsx": PAGE, "app/shop/index.tsx": "import { buy } from './remote'; export const Page = () => buy", "app/shop/remote.ts": remote });
    const server = await serve(root);

    const stub = (await server.transformRequest("/app/shop/remote.ts"))?.code;
    expect(stub).toContain('export const Payment = define("/shop#Payment", "Payment", "http:HttpError")');
    expect(stub).not.toContain("twin(");
  });

  it("will define a sidecar's error under a parent from the sidecar above it, loading that stub first", async () => {
    const root = project({
      "app/index.tsx": PAGE,
      "app/remote.ts": `import { HttpError } from "@expressive/rpc"; export class Billing extends HttpError { status = 402; }`,
      "app/shop/index.tsx": "import { buy } from './remote'; export const Page = () => buy",
      "app/shop/remote.ts": `import { Billing } from "../remote"; export class Late extends Billing {} export async function buy() {}`,
    });
    const server = await serve(root);

    const stub = (await server.transformRequest("/app/shop/remote.ts"))?.code;
    expect(stub).toMatch(/import "\/app\/remote\.ts(\?[^"]*)?";/);
    expect(stub).toContain('export const Late = define("/shop#Late", "Late", "/#Billing")');
    expect((await server.transformRequest("/app/remote.ts"))?.code).toContain('export const Billing = define("/#Billing", "Billing", "http:HttpError")');
  });

  it("will rebuild a sidecar's http error subclass on the client as an HttpError", async () => {
    const remote = `import { HttpError } from "@expressive/rpc";
      export class Payment extends HttpError { status = 402; }
      export async function buy() { throw new Payment("upgrade"); }`;
    const server = await serve(project({ "app/index.tsx": PAGE, "app/shop/remote.ts": remote }));
    const stub = (await server.transformRequest("/app/shop/remote.ts"))!.code;
    await server.listen(0);

    const http = client({ base: server.resolvedUrls!.local[0].replace(/\/$/, ""), headers: () => ({ "x-expressive-connection": TAB }) });
    const call = (at: string[], id: string, args: unknown[]) => http.call("/" + at.join("/"), id, args);
    const exports: Record<string, any> = {};
    new Function("call", "define", "exports", stub.replace(/^import .*$/gm, "").replace(/^export const (\w+) =/gm, "exports.$1 ="))(call, http.define, exports);

    const error = await exports.buy().catch((error: unknown) => error);

    expect(error).toBeInstanceOf(exports.Payment);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ message: "upgrade", status: 402 });
  });

  it("will build a twin's own instance on the module runner, under the route it names", async () => {
    const root = project({ "app/index.tsx": PAGE, "app/shop/remote.ts": POOLED });
    const server = await serve(root, expressive(), hostMvc(root));
    await server.transformRequest("/app/shop/remote.ts");
    await server.listen(0);

    const post = async (headers: Record<string, string>) => (await fetch(new URL("/shop/42", server.resolvedUrls!.local[0]), {
      method: "POST",
      headers: { "content-type": "application/json", "x-expressive-connection": TAB, "x-expressive-twin": "Cart-A", ...headers },
      body: "[]",
    })).json();

    expect(await post({ "x-expressive-get": "/shop#Cart" })).toEqual({ frame: { "Cart-A": { patch: { items: 0 }, version: expect.any(String) } } });
    expect(await post({ "x-expressive-call": "/shop#Cart.add" })).toEqual({ value: 1, frame: { "Cart-A": { patch: { items: 1 }, version: expect.any(String) } } });
  });

  it("will throw if a sidecar class reaches no Error", async () => {
    const server = await serve(project({ "app/index.tsx": PAGE, "app/tally/remote.ts": "class Base {} export class Odd extends Base {} export async function a() {}" }));

    await expect(server.transformRequest("/app/tally/remote.ts")).rejects.toThrow("Odd is a class but not an Error - only error classes reach the client.");
  });

  it("will refuse in dev a sidecar class that is not an Error", async () => {
    const server = await serve(project({
      "app/index.tsx": PAGE,
      "app/tally/remote.ts": `import { Plain } from "plain"; export class Odd extends Plain {} export async function a() {}`,
      "node_modules/plain/package.json": JSON.stringify({ name: "plain", type: "module", exports: "./index.js" }),
      "node_modules/plain/index.js": "export class Plain {}",
    }));
    await server.transformRequest("/app/tally/remote.ts");
    await server.listen(0);

    const res = await fetch(new URL("/tally", server.resolvedUrls!.local[0]), {
      method: "POST",
      headers: { "content-type": "application/json", "x-expressive-connection": TAB, "x-expressive-call": "a" },
      body: "[]",
    });

    expect(res.status).toBe(500);
  });

  it("will hold a tab's stream open on the dev server", async () => {
    const server = await serve(project({ "app/index.tsx": PAGE }));
    await server.listen(0);

    const abort = new AbortController();
    const res = await fetch(new URL(`/.expressive/stream?connection=${TAB}`, server.resolvedUrls!.local[0]), { signal: abort.signal });
    const { value } = await res.body!.getReader().read();

    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(new TextDecoder().decode(value)).toMatch(/^event: hello\ndata: \{"epoch":"[\w-]+"\}\n\n/);

    abort.abort();
  });

  it("will dispatch a call on the module runner", async () => {
    const server = await serve(project({ "app/index.tsx": PAGE, "app/tally/remote.ts": SIDECAR }));
    await server.listen(0);
    const url = new URL("/tally", server.resolvedUrls!.local[0]);

    const post = (body: string) => fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-expressive-connection": TAB, "x-expressive-call": "add" }, body });

    expect((await post("[2, 3]")).status).toBe(404);

    await server.transformRequest("/app/tally/remote.ts");
    expect(await (await post("[2, 3]")).json()).toEqual({ value: 5, frame: {} });

    const over = await post("[10, 0]");
    expect(over.status).toBe(409);
    expect(await over.json()).toEqual({ error: "/tally#Over", message: "Too big", status: 409 });

    const page = await fetch(url, { headers: { accept: "text/html" } });
    expect(await page.text()).toContain('<div id="root"></div>');
  });

  const CALLER = "import { add, Over } from './remote'; export const Page = () => [add, Over]";

  it("will call a module inside a remote/ folder by its path", async () => {
    const root = project({
      "app/index.tsx": PAGE,
      "app/tally/index.tsx": "import { add } from './remote/math/sum'; export const Page = () => add",
      "app/tally/remote/math/sum.ts": SIDECAR,
    });
    const server = await serve(root);

    const stub = (await server.transformRequest("/app/tally/remote/math/sum.ts"))?.code;
    expect(stub).toContain('call(at, "math/sum:add", args)');
    expect(stub).toContain('define("/tally#math/sum:Over", "Over")');

    await server.listen(0);
    const res = await fetch(new URL("/tally", server.resolvedUrls!.local[0]), {
      method: "POST",
      headers: { "content-type": "application/json", "x-expressive-connection": TAB, "x-expressive-call": "math/sum:add" },
      body: "[2, 3]",
    });

    expect(await res.json()).toEqual({ value: 5, frame: {} });
  });

  it("will throw if a module outside its folder imports a remote/ module", async () => {
    const root = project({ "app/index.tsx": "import { add } from './tally/remote/sum'; export const Page = () => add", "app/tally/remote/sum.ts": SIDECAR });
    const server = await serve(root);

    await expect(server.transformRequest("/app/index.tsx")).rejects.toThrow("only modules in app/tally/ and below may call it");
  });

  async function buildBoth(files: Record<string, string>, options: { env?: boolean } = {}) {
    const root = project(files);
    const quiet = (config: InlineConfig) => {
      config.configFile = false;
      config.logLevel = "silent";
      config.resolve = SOURCES;
      config.build!.rollupOptions = { ...config.build!.rollupOptions, external: ["@expressive/dev", "@expressive/dev/server"] };
      return config;
    };
    const code = (out: any) => (Array.isArray(out) ? out[0] : out).output.map((o: any) => o.code ?? "").join("\n");

    const client = code(await build(quiet(clientBuild(root, { write: false, ...options }))));
    const out: any = await build(quiet(serverBuild(root, { write: false, ...options })));
    const server = code(out);
    const boot = (Array.isArray(out) ? out[0] : out).output.find((o: any) => o.fileName === "index.js")?.code;

    return { client, server, boot };
  }

  it("builds the node service with the calls the client imports, by hashed ids", async () => {
    const { client, server } = await buildBoth({
      "app/index.tsx": PAGE,
      "app/blog/[slug]/index.tsx": CALLER,
      "app/blog/[slug]/remote/index.ts": SIDECAR,
      "app/blog/[slug]/remote/unused.ts": "export async function secret() { return 1 }",
    });

    expect(server).toMatch(/pattern: \["blog", ":slug"\]/);
    expect(server).toContain("a + b");
    expect(server).not.toContain("secret");

    const [, id] = /"([\w-]{16})": Over/.exec(server) ?? [];
    expect(id).toBeDefined();
    expect(client).toContain(id);
    expect(client).not.toContain("blog/:slug#Over");
  });

  it("builds the node service with each folder's seat and its methods", async () => {
    const { server } = await buildBoth({
      "index.ts": "export default { remote: { opaque: false } };",
      "app/index.tsx": PAGE,
      "app/remote.ts": `${HOST} export default class Site extends Model {}`,
      "app/tally/index.tsx": "import Tally from './remote'; export const Page = () => Tally",
      "app/tally/remote.ts": SEAT,
    });

    expect(server).toMatch(/seats: \[\{\s*pattern: \[\],\s*Type: Site\s*\}, \{\s*pattern: \["tally"\],\s*Type: Tally\s*\}\]/);
    expect(server).toMatch(/seat: \{\s*"fields": \["total"\],\s*"methods": \{\s*"default\.add": "add"\s*\}\s*\}/);
  });

  it("builds the node service with each folder's pooled classes", async () => {
    const { server } = await buildBoth({
      "index.ts": "export default { remote: { opaque: false } };",
      "app/index.tsx": PAGE,
      "app/shop/index.tsx": "import { Cart } from './remote'; export const Page = () => Cart",
      "app/shop/remote.ts": POOLED,
    });

    expect(server).toMatch(/pool: \{\s*"\/shop#Cart": \{\s*Type: Cart,\s*fields: \["items"\],\s*methods: \{\s*"\/shop#Cart\.add": "add"\s*\}\s*\}\s*\}/);
  });

  it("builds the node service with a seat's children and their methods", async () => {
    const { server } = await buildBoth({
      "index.ts": "export default { remote: { opaque: false } };",
      "app/index.tsx": PAGE,
      "app/order/index.tsx": "import Order from './remote'; export const Page = () => Order",
      "app/order/remote.ts": OWNER,
    });

    expect(server).toMatch(/seat: \{\s*"fields": \["line"\],\s*"children": \{\s*"line": \{\s*"fields": \["qty"\]\s*\}\s*\},\s*"methods": \{\s*"default\.reset": "reset",\s*"default\.line\.bump": "line\.bump"\s*\}\s*\}/);
  });

  it("builds readable ids when index.ts sets remote.opaque off", async () => {
    const { client, server } = await buildBoth({
      "index.ts": "export default { remote: { opaque: false } };",
      "app/index.tsx": PAGE,
      "app/blog/[slug]/index.tsx": CALLER,
      "app/blog/[slug]/remote.ts": SIDECAR,
    });

    expect(server).toMatch(/"\/blog\/:slug#Over": Over/);
    expect(server).toMatch(/"?add"?: add/);
    expect(client).toContain("/blog/:slug#Over");
  });

  it("will boot the node service in production mode with .env registered", async () => {
    const { boot } = await buildBoth({ "app/index.tsx": PAGE });

    expect(boot).toBe(`process.env.NODE_ENV ||= "production";\n(await import("@expressive/dev/server")).registerEnv();\nawait import("./app.js");\n`);
  });

  it("will boot without .env files for --no-env", async () => {
    const { boot } = await buildBoth({ "app/index.tsx": PAGE }, { env: false });

    expect(boot).toBe(`process.env.NODE_ENV ||= "production";\nawait import("./app.js");\n`);
  });

  it("will not add a boot file when the entry is already index.js", async () => {
    const root = project({ "app/index.tsx": PAGE });
    const config = (fn: typeof clientBuild) => {
      const config = fn(root, { write: false });
      config.configFile = false;
      config.logLevel = "silent";
      config.resolve = SOURCES;
      config.build!.rollupOptions = { ...config.build!.rollupOptions, external: ["@expressive/dev", "@expressive/dev/server"], output: { entryFileNames: "index.js" } };
      return config;
    };

    await build(config(clientBuild));
    const out: any = await build(config(serverBuild));

    expect((Array.isArray(out) ? out[0] : out).output.map((o: any) => o.fileName)).toEqual(["index.js"]);
  });

  it("will not build the node service before the client", async () => {
    const config = serverBuild(project({ "app/index.tsx": PAGE }), { write: false });
    config.configFile = false;
    config.logLevel = "silent";
    config.resolve = SOURCES;

    await expect(build(config)).rejects.toThrow("run the client build first");
  });

  it("builds the node service with index.ts as its settings, and fails a host there", async () => {
    const { server } = await buildBoth({ "app/index.tsx": PAGE, "index.ts": "export default { port: 4000 };" });

    expect(server).toContain('from "@expressive/dev/server"');
    expect(server).toMatch(/listen\(\{\s*settings/);
    expect(server).toMatch(/port: 4(000|e3)/);
    await expect(buildBoth({ "app/index.tsx": PAGE, "index.ts": "export default { host: () => ({}) };" })).rejects.toThrow("`host` is for the fetch target only");
  });

  it("builds a static site with a bundled entry and no dev script", async () => {
    const root = project({ "app.tsx": "export default () => <h1>hi</h1>" });
    const out = await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [expressive()],
      resolve: SOURCES,
      build: { write: false, outDir: "dist/client" },
    });
    const { output } = Array.isArray(out) ? out[0] : (out as { output: any[] });
    const html = output.find((o: any) => o.fileName === "index.html")?.source as string;

    expect(html).toContain('<div id="root"></div>');
    expect(html).toMatch(/<script type="module" crossorigin src="\/assets\/index-[^"]+\.js"><\/script>/);
    expect(html).not.toContain(".expressive/main.tsx");
  });

  it("builds from a project's own index.html", async () => {
    const root = project({ "app.tsx": "export default () => <h1>hi</h1>", "index.html": "<html><head><title>Mine</title></head><body></body></html>" });
    const out = await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [expressive()],
      resolve: SOURCES,
      build: { write: false, outDir: "dist/client" },
    });
    const { output } = Array.isArray(out) ? out[0] : (out as { output: any[] });
    const html = output.find((o: any) => o.fileName === "index.html")?.source as string;

    expect(html).toContain("<title>Mine</title>");
    expect(html).toContain('<div id="root"></div>');
    expect(html).toMatch(/<script type="module" crossorigin src="\/assets\/index-[^"]+\.js"><\/script>/);
  });

  it("will serve the prerender entry, listing paths only from modules below a dynamic segment", async () => {
    const server = await serve(project({
      "app/index.tsx": PAGE + "; export const paths = () => [];",
      "app/blog/[slug].tsx": PAGE + "; export const paths = () => [];",
    }));

    const entry = await server.pluginContainer.load(join(server.config.root, ".expressive/prerender.tsx"));
    const code = typeof entry == "string" ? entry : entry!.code;

    expect(code).toContain(`import App from "./routes.tsx";`);
    expect(code).toContain(`import { paths as p0 } from "../app/blog/[slug].tsx";`);
    expect(code).not.toContain("app/index.tsx");
    expect(await server.transformRequest("/.expressive/prerender.tsx")).toBeTruthy();
  });

  it("will serve a single-file prerender entry", async () => {
    const server = await serve(project({ "app.tsx": "export default () => <h1>hi</h1>" }));
    const entry = await server.pluginContainer.load(join(server.config.root, ".expressive/prerender.tsx"));
    const code = typeof entry == "string" ? entry : entry!.code;

    expect(code).toContain(`import App from "../app.tsx";`);
    expect(code).toContain("for (const list of [])");
  });

  it("will resolve the prerender entry's renderer from this package", async () => {
    const root = project({ "app.tsx": "export default () => null" });
    const host = expressive();
    await resolveConfig({ root, configFile: false, logLevel: "silent", plugins: [host] }, "build");
    const resolve = vi.fn(async () => ({ id: "renderer" }));
    const hook = host.resolveId as (this: unknown, id: string, importer: string, options: object) => Promise<unknown>;

    expect(await hook.call({ resolve }, "@expressive/dom/server", join(realpathSync(root), ".expressive/prerender.tsx"), {})).toEqual({ id: "renderer" });
    expect(resolve).toHaveBeenCalledWith("@expressive/dom/server", expect.stringMatching(/plugin\.ts$/), { skipSelf: true });
  });

  it("will keep the prerender entry as a build's input, and the shell otherwise", async () => {
    const root = project({ "app.tsx": "export default () => <h1>hi</h1>" });
    const input = async (input: string) => (await resolveConfig({ root, configFile: false, logLevel: "silent", plugins: [expressive()], build: { rollupOptions: { input } } }, "build")).build.rollupOptions.input;

    expect(await input("/.expressive/prerender.tsx")).toBe("/.expressive/prerender.tsx");
    expect(await input("/x.ts")).toBe(join(realpathSync(root), "index.html"));
  });

  it("will serve the prerender build a call module that stops at the server", async () => {
    const root = project({ "app/index.tsx": PAGE });
    const host = expressive();
    await resolveConfig({ root, configFile: false, logLevel: "silent", plugins: [host], build: { rollupOptions: { input: "/.expressive/prerender.tsx" } } }, "build");
    const load = host.load as (this: unknown, id: string, options?: object) => Promise<unknown>;

    expect(await load.call({}, join(realpathSync(root), ".expressive/call.ts"))).toContain("Remote calls do not run at build.");
  });

  it("will throw if config is read before the dev server runs", async () => {
    await expect(expressive().api!.config()).rejects.toThrow("The dev server is not running.");
  });

  it("will read no config without index.ts, or one without a default", async () => {
    const host = expressive();
    await serve(project({ "app/index.tsx": PAGE }), host);
    expect(await host.api!.config()).toEqual({});

    const other = expressive();
    await serve(project({ "app/index.tsx": PAGE, "index.ts": "export const port = 1;" }), other);
    expect(await other.api!.config()).toEqual({});
  });

  it("will resolve the working directory as the root by default", async () => {
    const host = expressive() as any;
    await expect(host.config({}, { command: "serve", mode: "development" })).rejects.toThrow("Missing app.tsx");
  });

  it("will serve a project's own index.html as the shell", async () => {
    const server = await serve(project({ "app/index.tsx": PAGE, "index.html": "<html><body><p>mine</p></body></html>" }));
    await server.listen(0);

    const page = await fetch(new URL("/", server.resolvedUrls!.local[0]), { headers: { accept: "text/html" } });
    const html = await page.text();

    expect(html).toContain("<p>mine</p>");
    expect(html).toContain('<div id="root"></div>');
  });

  it("will leave requests that are not for a page to Vite", async () => {
    const server = await serve(project({ "app/index.tsx": PAGE }));
    await server.listen(0);

    const res = await fetch(new URL("/missing.json", server.resolvedUrls!.local[0]), { headers: { accept: "application/json" } });

    expect(res.status).toBe(404);
  });

  it("will pass a shell that fails to transform to Vite's error handler", async () => {
    const boom = { name: "boom", transformIndexHtml() { throw new Error("boom"); } };
    const server = await createServer({
      root: project({ "app/index.tsx": PAGE }),
      configFile: false,
      logLevel: "silent",
      plugins: [expressive(), boom],
      resolve: SOURCES,
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    servers.push(server);
    await server.listen(0);

    const res = await fetch(new URL("/", server.resolvedUrls!.local[0]), { headers: { accept: "text/html" } });

    expect(res.status).toBe(500);
  });

  it("will resolve a remote-named import outside app/ as usual", async () => {
    const server = await serve(project({ "app.tsx": "import { x } from './remote'; export default () => x", "remote.ts": "export const x = 1;" }));

    const app = await server.transformRequest("/app.tsx");

    expect(app?.code).toContain("/remote.ts");
  });

  it("will reload the page when a file under app/ is added or removed", async () => {
    const root = realpathSync(project({ "app/index.tsx": PAGE }));
    const server = await serve(root);
    const sent: unknown[] = [];
    server.ws.send = ((payload: unknown) => void sent.push(payload)) as any;

    server.watcher.emit("add", join(root, "app/about.tsx"));
    await server.transformRequest("/.expressive/routes.tsx");
    server.watcher.emit("unlink", join(root, "app/about.tsx"));
    server.watcher.emit("add", join(root, "elsewhere.ts"));

    expect(sent).toEqual([{ type: "full-reload" }, { type: "full-reload" }]);
  });

  it("will reload the page when an edit changes the route tree", async () => {
    const root = realpathSync(project({
      "app/index.tsx": PAGE,
      "app/helper.ts": "export const x = 1;",
    }));
    const index = join(root, "app/index.tsx");
    const server = await serve(root);
    const sent: unknown[] = [];

    server.ws.send = ((payload: { triggeredBy?: string }) =>
      void (payload.triggeredBy || sent.push(payload))) as any;

    const edit = async (file: string, source: string) => {
      writeFileSync(file, source);
      server.watcher.emit("change", file);
      await new Promise(resolve => setTimeout(resolve, 50));
    };

    await edit(index, `${PAGE}\nexport const early = 1;`);
    await server.transformRequest("/.expressive/routes.tsx");
    await edit(index, PAGE.replace("hi", "ho"));
    await edit(index, `${PAGE}\nexport const paths = () => [];`);
    await edit(index, "export function Page( {");
    await edit(join(root, "app/helper.ts"), "export const x = 2;");
    server.watcher.emit("change", join(root, "elsewhere.ts"));
    expect(sent).toEqual([]);

    writeFileSync(index, `${PAGE}\nexport function Layout({ children }) { return children }`);
    server.watcher.emit("change", index);

    await vi.waitFor(() => expect(sent).toEqual([{ type: "full-reload" }]));
    expect((await server.transformRequest("/.expressive/routes.tsx"))?.code).toContain("Layout as RootLayout");
  });

  it("builds the node service for a single-file project", async () => {
    const { server } = await buildBoth({ "app.tsx": "export default () => <h1>hi</h1>" });

    expect(server).toContain('from "@expressive/dev/server"');
  });

  const FETCH = {
    "index.ts": `
      export { Counter } from "./counter";
      export default {
        target: "fetch",
        port: 8080,
        remote: { opaque: false },
        async handle({ request, env, ctx, next }: any) {
          const { pathname } = new URL(request.url);
          ((globalThis as any).handled ??= []).push(pathname);
          ctx.waitUntil(Promise.reject(new Error("late")));
          if (request.headers.has("x-fail")) throw new Error("no session");
          if (pathname === "/hello") return (await import("./hello")).hello(env);
          const reply = await next();
          reply.headers.set("x-handled", "1");
          return reply;
        },
        host: (app: unknown) => ({ cron: (env: any) => [env.NAME, typeof app] }),
      };
    `,
    "hello.ts": "export const hello = (env: any) => Response.json({ name: env.NAME ?? null });",
    "counter.ts": "export class Counter {}",
    "app/index.tsx": PAGE,
    "app/shop/index.tsx": "import { price } from './remote'; export const Page = () => price",
    "app/shop/remote.ts": "export async function price() { return 3; }",
    "app/tally/index.tsx": "import { add, bound } from './remote'; export const Page = () => [add, bound]",
    "app/tally/remote.ts": `${SIDECAR}
      import { Current } from "@expressive/rpc";
      export async function bound() { return ((globalThis.hostCurrent ?? Current).get().env as any).NAME; }
    `,
    "public/robots.txt": "robots",
  };

  const post = (path: string, name: string, body: string) =>
    new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-expressive-call": name }, body });

  it("builds the fetch entry: settings, remotes and named exports composed, host's value exported, every dependency bundled", async () => {
    const root = project(FETCH);
    const quiet = (config: InlineConfig) => ({ ...config, configFile: false as const, logLevel: "silent" as const, resolve: SOURCES });

    await build(quiet(clientBuild(root)));
    await build(quiet(serverBuild(root)));

    const dir = join(root, "dist/server");
    const code = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(file => /\.m?js$/.test(file)).map(file => readFileSync(join(dir, file), "utf8")).join("\n");
    const { default: handler, ...named } = await import(join(dir, "index.js"));
    const env = { NAME: "prod" };
    const ctx = { waitUntil: (promise: Promise<unknown>) => void promise.catch(() => {}) };
    const imports = [...code.matchAll(/from\s*"([^"]+)"|import\s*"([^"]+)"/g)].map(([, a, b]) => a ?? b).filter(spec => !spec.startsWith("./"));

    expect(await (await handler.fetch(post("/tally", "add", "[2, 3]"), env, ctx)).json()).toEqual({ value: 5 });
    expect(await (await handler.fetch(post("/shop", "price", "[]"), env, ctx)).json()).toEqual({ value: 3 });
    expect(await (await handler.fetch(post("/tally", "bound", "[]"), env, ctx)).json()).toEqual({ value: "prod" });
    expect((await handler.fetch(post("/tally", "add", "[10, 0]"), env, ctx)).status).toBe(409);
    expect(await (await handler.fetch(new Request("http://localhost/hello"), env, ctx)).json()).toEqual({ name: "prod" });
    expect((await handler.fetch(new Request("http://localhost/"), env, ctx)).headers.get("x-handled")).toBe("1");
    expect(Object.keys(handler).sort()).toEqual(["cron", "fetch"]);
    expect(handler.cron(env)).toEqual(["prod", "function"]);
    expect(Object.keys(named)).toEqual(["Counter"]);
    expect([...new Set(imports)].sort()).toEqual(["node:async_hooks", "node:crypto"]);
    expect(code).not.toContain("createServer");
  });

  it("will fail a build and the dev server on a 0.5 setting or a bindings export, by name", async () => {
    const quiet = (config: InlineConfig) => ({ ...config, configFile: false as const, logLevel: "silent" as const, resolve: SOURCES });
    const old = project({ "index.ts": "export default { around: (next: any) => next() };", "app/index.tsx": PAGE });
    const bindings = project({ "index.ts": "export const bindings = () => ({}); export default {};", "app/index.tsx": PAGE });
    const host = expressive();

    await expect(build(quiet(serverBuild(old)))).rejects.toThrow("`fetch` and `around` became `handle`.");
    await serve(bindings, host);
    await expect(host.api!.config()).rejects.toThrow("`bindings` became `config.env`, set in index.dev.ts.");
  });

  it("will run handle in dev around calls, pages and public files, but not Vite's own requests", async () => {
    (globalThis as any).hostCurrent = Current;
    (globalThis as any).handled = [];
    const root = project(FETCH);
    const server = await serve(root);
    const error = vi.spyOn(server.config.logger, "error").mockImplementation(() => {});
    await server.listen(0);
    const at = (path: string) => new URL(path, server.resolvedUrls!.local[0]);
    const call = (headers: Record<string, string> = {}) => fetch(at("/tally"), { method: "POST", headers: { "content-type": "application/json", "x-expressive-connection": TAB, "x-expressive-call": "add", ...headers }, body: "[1, 2]" });

    await server.transformRequest("/app/tally/remote.ts");

    const added = await call();
    const refused = await call({ "x-fail": "1" });
    const shell = await fetch(at("/invite/abc"), { headers: { accept: "text/html" } });
    const missing = await fetch(at("/missing.json"));

    expect(await added.json()).toEqual({ value: 3, frame: {} });
    expect(added.headers.get("x-handled")).toBe("1");
    expect([refused.status, (await refused.json()).message]).toEqual([500, "no session"]);
    expect(await (await fetch(at("/hello"))).json()).toEqual({ name: null });
    expect(await shell.text()).toMatch(/\/@vite\/client[^]*<div id="root"><\/div>/);
    expect(shell.headers.get("x-handled")).toBe("1");
    expect(await (await fetch(at("/robots.txt"))).text()).toBe("robots");
    expect([missing.status, missing.headers.get("x-handled"), missing.headers.has("x-expressive-fell")]).toEqual([404, "1", false]);

    for (const path of ["/@vite/client", "/app/index.tsx", "/index.ts?import", "/.expressive/main.tsx"]) await fetch(at(path));

    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("waitUntil: Error: late"));
    expect((globalThis as any).handled.splice(0)).toEqual(["/tally", "/tally", "/invite/abc", "/missing.json", "/hello", "/robots.txt"]);
    delete (globalThis as any).hostCurrent;
    delete (globalThis as any).handled;
  });

  it("will skip handle outside base, under a proxy, for Vite's flags and for source files outside public/ and api/", async () => {
    const root = realpathSync(project({
      "index.ts": "export default { handle({ request }: any) { ((globalThis as any).handled ??= []).push(new URL(request.url).pathname + new URL(request.url).search); return new Response('handled'); } };",
      "app/index.tsx": PAGE,
      "public/robots.txt": "robots",
      "api/hook.ts": "export {};",
      "src/util.ts": "export {};",
    }));
    (globalThis as any).handled = [];
    const server = await createServer({
      root,
      base: "/base/",
      configFile: false,
      logLevel: "silent",
      plugins: [expressive()],
      resolve: SOURCES,
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { watch: null, proxy: { "/proxied": "http://127.0.0.1:9", "^/re/.*": "http://127.0.0.1:9" } },
    });
    servers.push(server);
    await server.listen(0);
    const origin = new URL(server.resolvedUrls!.local[0]).origin;

    for (const path of ["/outside", "/proxied/a", "/re/b", "/base/src/util.ts", "/base/x?url", "/base/x?raw=", "/base/robots.txt", "/base/api/hook.ts", "/base/x?url=https://a", "/base/%E0", "/base/page"])
      await fetch(origin + path).catch(() => {});

    expect((globalThis as any).handled.splice(0)).toEqual(["/base/robots.txt", "/base/api/hook.ts", "/base/x?url=https://a", "/base/%E0", "/base/page"]);
    delete (globalThis as any).handled;
  });

  it("will hand a request handle passes to no answer on to Vite's stack, as handle forwarded it", async () => {
    const echo = {
      name: "echo",
      configureServer(server: ViteDevServer) {
        server.middlewares.use("/echo", async (req, res) => {
          let body = "";
          for await (const chunk of req) body += chunk;
          res.end(`${req.method} ${req.originalUrl} ${req.headers["x-forwarded"] ?? "-"} ${body}`);
        });
      },
    };
    const server = await createServer({
      root: project({
        "index.ts": `export default {
          async handle({ request, next }: any) {
            const url = new URL(request.url);
            if (url.pathname === "/old") return next(new Request(new URL("/echo?moved", url), { method: request.method, headers: { ...Object.fromEntries(request.headers), "x-forwarded": "1" }, body: request.body, duplex: "half" } as any));
            if (url.pathname === "/restyled") return new Response("restyled", { headers: (await next()).headers });
            if (request.headers.has("x-cookie")) {
              const reply = await next();
              reply.headers.append("set-cookie", "a=1");
              return reply;
            }
            if (request.headers.has("x-peek")) await request.clone().text();
            if (request.headers.has("x-read")) await request.text();
          },
        };`,
        "app/index.tsx": PAGE,
      }),
      configFile: false,
      logLevel: "silent",
      plugins: [expressive(), echo],
      resolve: SOURCES,
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { watch: null },
    });
    servers.push(server);
    await server.listen(0);
    const at = (path: string) => new URL(path, server.resolvedUrls!.local[0]);
    const text = async (path: string, init?: RequestInit) => (await fetch(at(path), init)).text();
    const error = vi.spyOn(server.config.logger, "error").mockImplementation(() => {});

    expect(await text("/echo")).toBe("GET /echo - ");
    expect(await text("/echo", { method: "POST", body: "untouched" })).toBe("POST /echo - untouched");
    expect(await text("/old", { method: "POST", body: "moved" })).toBe("POST /echo?moved 1 moved");
    expect(await text("/echo", { method: "POST", body: "peeked", headers: { "x-peek": "1" } })).toBe("POST /echo - peeked");
    expect(await text("/old")).toBe("GET /echo?moved 1 ");
    expect((await fetch(at("/echo"), { headers: { "x-cookie": "1" } })).headers.get("set-cookie")).toBe("a=1");
    expect([...(await fetch(at("/restyled"))).headers.keys()].filter(name => name.startsWith("x-"))).toEqual([]);
    expect((await fetch(at("/echo"), { method: "POST", body: "gone", headers: { "x-read": "1" } })).status).toBe(500);
    expect((await fetch(at("/nowhere"), { method: "POST", body: "x", headers: { "x-peek": "1" } })).status).toBe(404);
    error.mockRestore();
  });

  it("will pass a shell that fails to transform under handle to Vite's error handler", async () => {
    const boom = { name: "boom", transformIndexHtml() { throw new Error("boom"); } };
    const server = await createServer({
      root: project({ "index.ts": "export default { handle: () => {} };", "app/index.tsx": PAGE }),
      configFile: false,
      logLevel: "silent",
      plugins: [expressive(), boom],
      resolve: SOURCES,
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { watch: null },
    });
    servers.push(server);
    await server.listen(0);

    expect((await fetch(new URL("/", server.resolvedUrls!.local[0]), { headers: { accept: "text/html" } })).status).toBe(500);
  });

  it("will refuse a seat or a pooled class under the fetch target", async () => {
    const server = await serve(project({ "index.ts": `export default { target: "fetch" };`, "app/index.tsx": PAGE, "app/tally/remote.ts": SEAT, "app/shop/remote.ts": POOLED }));

    await expect(server.transformRequest("/app/tally/remote.ts")).rejects.toThrow("app/tally/remote.ts default-exports a seat - the fetch target keeps no state between requests");
    await expect(server.transformRequest("/app/shop/remote.ts")).rejects.toThrow("app/shop/remote.ts exports Model Cart - the fetch target");
  });

  it("will salt ids when index.ts has no default", async () => {
    const config = clientBuild(project({ "app/index.tsx": PAGE, "index.ts": "export const port = 1;" }), { write: false });
    config.configFile = false;
    config.logLevel = "silent";
    config.resolve = SOURCES;

    await expect(build(config)).resolves.toBeDefined();
  });
});

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
const PACKAGES = fileURLToPath(new URL("../../../", import.meta.url));
const ROUTER = fileURLToPath(new URL("../client/router.ts", import.meta.url));

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

  async function serve(root: string, host = expressive(), resolve = SOURCES, base?: string) {
    const server = await createServer({
      root,
      base,
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

  const GATED = `
    ${HOST}
    class Tally extends Model { total = 1; }
    export default function tally() { Tally.new(); }
    export async function peek() { return Tally.get().total; }
  `;

  it("will keep a remote default off the browser's stub - it gates the folder on the server", async () => {
    const root = project({ "app/index.tsx": PAGE, "app/tally/index.tsx": "import { peek } from './remote'; export const Page = () => peek", "app/tally/remote.ts": GATED });
    const server = await serve(root);

    const stub = (await server.transformRequest("/app/tally/remote.ts"))?.code;
    expect(stub).toContain('export const peek = (...args) => call(at, "peek", args);');
    expect(stub).not.toContain("export default");
    expect(stub).not.toContain("Tally.new");
  });

  it("will refuse a class default", async () => {
    const root = project({ "app/index.tsx": PAGE, "app/tally/remote.ts": `${HOST} export default class Tally extends Model {}` });
    const server = await serve(root);

    await expect(server.transformRequest("/app/tally/remote.ts")).rejects.toThrow("A remote default is its folder's gate - a function");
  });

  it("will leave a folder's remote out of the route tree", async () => {
    const server = await serve(project({ "app/index.tsx": PAGE, "app/tally/index.tsx": PAGE, "app/tally/remote.ts": GATED }));

    const routes = await server.transformRequest("/.expressive/routes.tsx");
    expect(routes?.code).not.toContain("remote");
  });

  it("will answer a folder's calls, but not its default's methods", async () => {
    const root = project({ "app/index.tsx": PAGE, "app/tally/remote.ts": GATED });
    const server = await serve(root, expressive(), hostMvc(root));
    await server.transformRequest("/app/tally/remote.ts");
    await server.listen(0);

    const post = (name: string, body = "[]") => fetch(new URL("/tally", server.resolvedUrls!.local[0]), {
      method: "POST",
      headers: { "content-type": "application/json", "x-expressive-call": name },
      body,
    });

    expect(await (await post("peek")).json()).toEqual({ value: 1 });
    expect((await post("default")).status).toBe(404);
  });

  it("will gate the calls below a folder by its default, imported by the client or not", async () => {
    const root = project({
      "app/index.tsx": PAGE,
      "app/site.ts": `${HOST} export class Site extends Model { name = "site"; }`,
      "app/remote.ts": `import { Site } from "./site"; export default () => void Site.new();`,
      "app/tally/remote.ts": `import { Site } from "../site"; export async function site() { return Site.get().name; }`,
    });
    const server = await serve(root, expressive(), hostMvc(root));
    await server.transformRequest("/app/tally/remote.ts");
    await server.listen(0);

    const res = await fetch(new URL("/tally", server.resolvedUrls!.local[0]), {
      method: "POST",
      headers: { "content-type": "application/json", "x-expressive-call": "site" },
      body: "[]",
    });

    expect(await res.json()).toEqual({ value: "site" });
  });

  it("will refuse a call whose gate throws, activates a Model whose new() fails, or is not a function", async () => {
    const root = project({
      "app/index.tsx": PAGE,
      "app/deny/remote.ts": `export default () => { throw new Error("No entry"); }; export async function open() { return 1; }`,
      "app/fail/remote.ts": `${HOST} class Session extends Model { new() { throw new Error("Sign in"); } } export default () => void Session.new(); export async function open() { return 1; }`,
      "app/bad/remote.ts": "export default class Bad {}",
      "app/bad/inner/remote.ts": "export async function open() { return 1; }",
    });
    const server = await serve(root, expressive(), hostMvc(root));
    await server.transformRequest("/app/deny/remote.ts");
    await server.transformRequest("/app/fail/remote.ts");
    await server.transformRequest("/app/bad/inner/remote.ts");
    await server.listen(0);

    const post = async (at: string) => {
      const res = await fetch(new URL(at, server.resolvedUrls!.local[0]), { method: "POST", headers: { "content-type": "application/json", "x-expressive-call": "open" }, body: "[]" });
      return [res.status, (await res.json()).message];
    };

    expect(await post("/deny")).toEqual([500, "No entry"]);
    expect(await post("/fail")).toEqual([500, "Sign in"]);
    expect(await post("/bad/inner")).toEqual([500, expect.stringContaining("app/bad/remote.ts: A remote default is its folder's gate - a function")]);
  });

  it("will answer a gate check for a folder the client has not loaded, with its error classes' fields", async () => {
    const root = project({
      "app/index.tsx": PAGE,
      "app/vault/index.tsx": PAGE,
      "app/vault/remote.ts": `
        export class SignIn extends Error { status = 302; location = "/login"; }
        export const limit = 3;
        export default () => { if ((globalThis as any).vaultCurrent.get().request.headers.has("x-deny")) throw new SignIn("Sign in."); };
      `,
    });
    (globalThis as any).vaultCurrent = Current;
    const server = await serve(root, expressive(), hostMvc(root));
    await server.listen(0);

    const check = async (deny: boolean) => {
      const headers = { "content-type": "application/json", "x-expressive-get": "gates", ...(deny && { "x-deny": "1" }) };
      const res = await fetch(new URL("/vault", server.resolvedUrls!.local[0]), { method: "POST", headers, body: "[]" });
      return [res.status, await res.json()];
    };

    expect(await check(false)).toEqual([200, {}]);
    expect(await check(true)).toEqual([400, { error: "/vault#SignIn", message: "Sign in.", status: 302, location: "/login" }]);
    expect((await server.transformRequest("/.expressive/routes.tsx"))?.code).toMatch(/"to": "vault",\s*"gate": 1/);
  });

  it("will tell the browser when a gate is edited, so its passes clear", async () => {
    const root = realpathSync(project({
      "app/index.tsx": PAGE,
      "app/vault/remote.ts": "export default () => {}",
      "app/tally/remote.ts": "export async function add() { return 1; }",
      "app/tally/more.ts": "export const x = 1;",
      "app/broken/remote.ts": "export default (",
    }));
    const server = await serve(root);
    const sent: unknown[] = [];
    server.ws.send = ((payload: { type: string }) => void (payload.type == "custom" && sent.push(payload))) as any;

    for (const file of ["app/vault/remote.ts", "app/tally/remote.ts", "app/tally/more.ts", "app/broken/remote.ts", "elsewhere.ts"]) server.watcher.emit("change", join(root, file));

    expect(sent).toEqual([{ type: "custom", event: "expressive:gates" }]);
  });

  it("will throw if a sidecar exports what the client cannot call", async () => {
    const root = project({ "app/index.tsx": PAGE, "app/tally/index.tsx": "import { add } from './remote'; export const Page = () => add", "app/tally/remote.ts": "export const add = 1" });
    const server = await serve(root);

    await expect(server.transformRequest("/app/tally/remote.ts")).rejects.toThrow("add is neither an async function nor an Error subclass");
  });

  it("will refuse an exported Model class", async () => {
    const root = project({ "app/index.tsx": PAGE, "app/shop/index.tsx": "import { Cart } from './remote'; export const Page = () => Cart", "app/shop/remote.ts": `${HOST} export class Cart extends Model {}` });
    const server = await serve(root);

    await expect(server.transformRequest("/app/shop/remote.ts")).rejects.toThrow("Cart is a class but not an Error");
  });

  it("will post a call to its sidecar's path from any page", async () => {
    const server = await serve(project({ "app/index.tsx": PAGE }));
    const { call } = await server.ssrLoadModule("/.expressive/call.ts");
    const { entering } = await server.ssrLoadModule(ROUTER);
    const posted: string[] = [];

    vi.stubGlobal("location", { pathname: "/blog/hello/comments", href: "http://localhost/blog/hello/comments" });
    vi.stubGlobal("fetch", async (url: string) => (posted.push(url), new Response('{"value":1}', { headers: { "content-type": "application/json; codec=expressive" } })));

    try {
      expect([await call([], "root", []), await call(["blog", ":slug"], "like", [])]).toEqual([1, 1]);
      expect(await call(["tally"], "add", [])).toBe(1);
      expect(await call(["blog", "*"], "rest", [])).toBe(1);
      await expect(call(["shop", ":id"], "buy", [])).rejects.toThrow("buy() belongs to /shop/:id and cannot be called from /blog/hello/comments.");

      vi.stubGlobal("window", {});
      expect(await entering("/shop/7", () => call(["shop", ":id"], "buy", []))).toBe(1);
      expect(await entering("/shop/7", () => call(["blog", ":slug"], "like", []))).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(posted).toEqual(["/", "/blog/hello", "/tally", "/blog/hello/comments", "/shop/7", "/blog/hello"]);
  });

  it("will post a call under a non-root base, filling params from the path below it", async () => {
    const server = await serve(project({ "app/index.tsx": PAGE }), expressive(), SOURCES, "/app/");
    const { call } = await server.ssrLoadModule("/.expressive/call.ts");
    const { entering } = await server.ssrLoadModule(ROUTER);
    const posted: string[] = [];

    vi.stubGlobal("location", { pathname: "/app/blog/hello", href: "http://localhost/app/blog/hello" });
    vi.stubGlobal("fetch", async (url: string) => (posted.push(url), new Response('{"value":1}', { headers: { "content-type": "application/json; codec=expressive" } })));

    try {
      await call([], "root", []);
      await call(["tally"], "add", []);
      await call(["blog", ":slug"], "like", []);
      vi.stubGlobal("window", {});
      await entering("/app/shop/7", () => call(["shop", ":id"], "buy", []));
    } finally {
      vi.unstubAllGlobals();
    }

    expect(posted).toEqual(["/app/", "/app/tally", "/app/blog/hello", "/app/shop/7"]);
  });

  it("will answer calls and gate checks under a non-root base, and none outside it", async () => {
    const root = project({
      "app/index.tsx": "import { hi } from './remote'; export const Page = () => hi",
      "app/remote.ts": "export async function hi() { return 'root'; }",
      "app/tally/index.tsx": "import { add } from './remote'; export const Page = () => add",
      "app/tally/remote.ts": SIDECAR,
      "app/blog/[slug]/index.tsx": "import { slug } from './remote'; export const Page = () => slug",
      "app/blog/[slug]/remote.ts": "export async function slug() { return 'blog'; }",
      "app/vault/index.tsx": PAGE,
      "app/vault/remote.ts": "export default () => {}",
    });
    const server = await serve(root, expressive(), SOURCES, "/app/");

    for (const file of ["/app/remote.ts", "/app/tally/remote.ts", "/app/blog/[slug]/remote.ts"]) await server.transformRequest(file);
    await server.listen(0);

    const post = async (at: string, headers: Record<string, string>, body = "[]") => {
      const res = await fetch(new URL(at, server.resolvedUrls!.local[0]), { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
      return [res.status, res.headers.get("content-type")?.includes("json") ? await res.json() : undefined];
    };

    expect(await post("/app/", { "x-expressive-call": "hi" })).toEqual([200, { value: "root" }]);
    expect(await post("/app/tally", { "x-expressive-call": "add" }, "[2, 3]")).toEqual([200, { value: 5 }]);
    expect(await post("/app/blog/hello", { "x-expressive-call": "slug" })).toEqual([200, { value: "blog" }]);
    expect(await post("/app/vault", { "x-expressive-get": "gates" })).toEqual([200, {}]);
    expect((await post("/tally", { "x-expressive-call": "add" }, "[2, 3]"))[0]).toBe(404);
  });

  it("will serve an exported subclass of an http error to the browser as an error", async () => {
    const remote = `import { HttpError } from "@expressive/rpc";
      export class Payment extends HttpError { status = 402; }
      export async function buy() { throw new Payment("upgrade"); }`;
    const root = project({ "app/index.tsx": PAGE, "app/shop/index.tsx": "import { buy } from './remote'; export const Page = () => buy", "app/shop/remote.ts": remote });
    const server = await serve(root);

    const stub = (await server.transformRequest("/app/shop/remote.ts"))?.code;
    expect(stub).toContain('export const Payment = define("/shop#Payment", "Payment", "http:HttpError")');
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

    const http = client({ base: server.resolvedUrls!.local[0].replace(/\/$/, "") });
    const call = (at: string[], id: string, args: unknown[]) => http.call("/" + at.join("/"), id, args);
    const exports: Record<string, any> = {};
    new Function("call", "define", "exports", stub.replace(/^import .*$/gm, "").replace(/^export const (\w+) =/gm, "exports.$1 ="))(call, http.define, exports);

    const error = await exports.buy().catch((error: unknown) => error);

    expect(error).toBeInstanceOf(exports.Payment);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ message: "upgrade", status: 402 });
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
      headers: { "content-type": "application/json", "x-expressive-call": "a" },
      body: "[]",
    });

    expect(res.status).toBe(500);
  });

  it("will dispatch a call on the module runner", async () => {
    const server = await serve(project({ "app/index.tsx": PAGE, "app/tally/remote.ts": SIDECAR }));
    await server.listen(0);
    const url = new URL("/tally", server.resolvedUrls!.local[0]);

    const post = (body: string) => fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-expressive-call": "add" }, body });

    expect((await post("[2, 3]")).status).toBe(404);

    await server.transformRequest("/app/tally/remote.ts");
    expect(await (await post("[2, 3]")).json()).toEqual({ value: 5 });

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
      headers: { "content-type": "application/json", "x-expressive-call": "math/sum:add" },
      body: "[2, 3]",
    });

    expect(await res.json()).toEqual({ value: 5 });
  });

  it("will throw if a module outside its folder imports a remote/ module", async () => {
    const root = project({ "app/index.tsx": "import { add } from './tally/remote/sum'; export const Page = () => add", "app/tally/remote/sum.ts": SIDECAR });
    const server = await serve(root);

    await expect(server.transformRequest("/app/index.tsx")).rejects.toThrow("only modules in app/tally/ and below may call it");
  });

  async function buildBoth(files: Record<string, string>, { assetsDir, base, ...options }: { env?: boolean; assetsDir?: string; base?: string } = {}) {
    const root = project(files);
    const quiet = (config: InlineConfig) => {
      config.configFile = false;
      config.logLevel = "silent";
      config.resolve = SOURCES;
      config.base = base;
      if (assetsDir) config.build!.assetsDir = assetsDir;
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
    expect(server).toMatch(/"patterns": \["\/", "\/blog\/:slug"\]/);
    expect(server).toContain("a + b");
    expect(server).not.toContain("secret");

    const [, id] = /"([\w-]{16})": Over/.exec(server) ?? [];
    expect(id).toBeDefined();
    expect(client).toContain(id);
    expect(client).not.toContain("blog/:slug#Over");
  });

  it("builds the node service with each folder's gate", async () => {
    const { server } = await buildBoth({
      "index.ts": "export default { remote: { opaque: false } };",
      "app/index.tsx": PAGE,
      "app/remote.ts": "export default function site() {}",
      "app/tally/index.tsx": "import { peek } from './remote'; export const Page = () => peek",
      "app/tally/remote.ts": GATED,
    });

    expect(server).toMatch(/gates: \[\{\s*pattern: \[\],\s*gate: site\s*\}, \{\s*pattern: \["tally"\],\s*gate: tally\s*\}\]/);
  });

  it("bundles the gate check only into an app with a gated folder, calls or not", async () => {
    const bundle = async (files: Record<string, string>) => {
      const config = clientBuild(project(files), { write: false });
      const out: any = await build({ ...config, configFile: false, logLevel: "silent", resolve: SOURCES });

      return out.output.map((o: any) => o.code ?? "").join("\n");
    };
    const app = { "app/index.tsx": PAGE, "app/vault/index.tsx": "import { peek } from './remote'; export const Page = () => peek" };
    const calls = "export async function peek() { return 1; }";

    expect(await bundle({ ...app, "app/vault/index.tsx": PAGE })).not.toContain("expressive:gates");
    expect(await bundle({ ...app, "app/vault/remote.ts": calls })).not.toContain("expressive:gates");
    expect(await bundle({ ...app, "app/vault/remote.ts": `export default () => {}; ${calls}` })).toContain("expressive:gates");
  });

  it("builds the node service and the client's calls and gate check under a non-root base", async () => {
    const { client, server } = await buildBoth({ "app/index.tsx": PAGE, "app/vault/index.tsx": CALLER, "app/vault/remote.ts": `export default () => {}; ${SIDECAR}` }, { base: "/app/" });

    expect(server).toMatch(/"base": "\/app\/"/);
    expect(client).toMatch(/[`"]\/app\/[`"]\)/);
  });

  it("builds a gated folder the client never imports as an endpoint, with its error classes and no calls", async () => {
    const { server } = await buildBoth({
      "index.ts": "export default { remote: { opaque: false } };",
      "app/index.tsx": PAGE,
      "app/vault/index.tsx": PAGE,
      "app/vault/denied.ts": "export class Denied extends Error {}",
      "app/vault/remote.ts": `import { Denied } from "./denied"; export class SignIn extends Denied {} export default () => {}; export async function secret() { return 1; }`,
    });

    expect(server).toMatch(/pattern: \["vault"\],\s*async exports\(\) \{\s*return \{\s*calls: \{\},\s*classes: \{ "\/vault#SignIn": SignIn \}/);
  });

  it("will check a gated folder's remote entry at build, imported by the client or not", async () => {
    await expect(buildBoth({ "app/index.tsx": PAGE, "app/vault/remote.ts": "export default () => {}; export const limit = 3;" })).rejects.toThrow("app/vault/remote.ts: limit");
  });

  it("will check every remote entry's default at build, imported by the client or not", async () => {
    const files = (index: string, remote: string) => ({ "index.ts": index, "app/index.tsx": PAGE, "app/remote.ts": remote, "app/site.ts": "export default () => {}" });

    await expect(buildBoth(files("export default {};", `${HOST} export default class Site extends Model {}`))).rejects.toThrow("app/remote.ts: A remote default is its folder's gate - a function");
    await expect(buildBoth(files("export default {};", `export { default } from "./site";`))).rejects.toThrow("a re-exported one is not checked");
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

  const DEV = `import settings from "./index";\n(settings as any).env = () => ({});\nexport default settings;\n`;

  it("will read index.dev.ts in place of index.ts, with or without one", async () => {
    const host = expressive();
    await serve(project({ "app/index.tsx": PAGE, "index.ts": "export default { port: 0 };", "index.dev.ts": DEV }), host);

    expect(await host.api!.config()).toEqual({ port: 0, env: expect.any(Function) });
    expect(await host.api!.config()).toEqual({ port: 0, env: expect.any(Function) });

    const alone = expressive();
    await serve(project({ "app/index.tsx": PAGE, "index.dev.ts": "export default { port: 2, env: () => ({}) };" }), alone);
    expect(await alone.api!.config()).toEqual({ port: 2, env: expect.any(Function) });

    const bare = expressive();
    await serve(project({ "app/index.tsx": PAGE, "index.ts": "export default { port: 0 };", "index.dev.ts": "export const port = 1;" }), bare);
    await expect(bare.api!.config()).rejects.toThrow("index.dev.ts: no default export");

    const wrong = expressive();
    await serve(project({ "app/index.tsx": PAGE, "index.dev.ts": "export default { env: { DB: 1 } };" }), wrong);
    await expect(wrong.api!.config()).rejects.toThrow("index.dev.ts: `env` is a function returning the bindings");
  });

  it("will refuse env set in index.ts, and a bindings export in index.dev.ts, pointing at index.dev.ts", async () => {
    const misplaced = expressive();
    const bindings = expressive();
    const number = expressive();

    await serve(project({ "app/index.tsx": PAGE, "index.ts": "export default { env: () => ({}) };", "index.dev.ts": `export { default } from "./index.ts";` }), misplaced);
    await serve(project({ "app/index.tsx": PAGE, "index.ts": "export default {};", "index.dev.ts": `export const bindings = 1; export default {};` }), bindings);
    await serve(project({ "app/index.tsx": PAGE, "index.ts": "export default 1;", "index.dev.ts": `export default {};` }), number);

    await expect(misplaced.api!.config()).rejects.toThrow("index.ts: `env` is set in index.dev.ts, never index.ts.");
    await expect(bindings.api!.config()).rejects.toThrow("index.dev.ts: `bindings` became `settings.env`, set in index.dev.ts.");
    await expect(number.api!.config()).rejects.toThrow("index.ts: the default export is not config({ ... }).");
  });

  it("will switch to index.dev.ts when it is added, and back when it is removed", async () => {
    const host = expressive();
    const root = project({ "app/index.tsx": PAGE, "index.ts": "export default { port: 0 };" });
    await serve(root, host);

    expect(await host.api!.config()).toEqual({ port: 0 });

    writeFileSync(join(root, "index.dev.ts"), DEV);
    expect(await host.api!.config()).toEqual({ port: 0, env: expect.any(Function) });

    rmSync(join(root, "index.dev.ts"));
    expect(await host.api!.config()).toEqual({ port: 0 });
  });

  const SEEN = "export default { handle: ({ env }: any) => { const g = globalThis as any; const same = g.seenEnv === env; g.seenEnv = env; return Response.json({ db: env.DB, name: env.DEV_NAME, calls: g.envCalls, same }); } };";

  it("will bind env() under process.env and .env in dev, once per server and again after a throw", async () => {
    (globalThis as any).envCalls = 0;
    vi.stubEnv("DEV_NAME", "process");
    const root = project({
      "app/index.tsx": PAGE,
      "index.ts": SEEN,
      "index.dev.ts": `
        import settings from "./index";
        (settings as any).env = async () => {
          if (++(globalThis as any).envCalls === 1) throw new Error("not yet");
          return { DB: "local", DEV_NAME: "bound" };
        };
        export default settings;
      `,
    });
    const server = await serve(root);
    const error = vi.spyOn(server.config.logger, "error").mockImplementation(() => {});
    await server.listen(0);
    const get = () => fetch(new URL("/", server.resolvedUrls!.local[0]));

    expect((await get()).status).toBe(500);
    expect(await (await get()).json()).toEqual({ db: "local", name: "process", calls: 2, same: false });
    expect(await (await get()).json()).toEqual({ db: "local", name: "process", calls: 2, same: true });

    for (const files of [{ "index.ts": SEEN } as Record<string, string>, { "index.ts": SEEN, "index.dev.ts": `import settings from "./index"; (settings as any).env = () => null; export default settings;` }]) {
      const other = await serve(project({ "app/index.tsx": PAGE, ...files }));
      await other.listen(0);
      const at = new URL("/", other.resolvedUrls!.local[0]);

      expect(await (await fetch(at)).json()).toMatchObject({ name: "process", same: false });
      expect(await (await fetch(at)).json()).toMatchObject({ name: "process", same: true });
    }

    error.mockRestore();
    vi.unstubAllEnvs();
    delete (globalThis as any).envCalls;
    delete (globalThis as any).seenEnv;
  });

  it("will resolve the working directory as the root by default", async () => {
    const host = expressive() as any;
    await expect(host.config({}, { command: "serve", mode: "development" })).rejects.toThrow("Missing app.tsx");
  });

  it("will serve a project's own index.html as the shell", async () => {
    const server = await serve(project({ "app/index.tsx": PAGE, "index.html": "<html><body><p>mine</p></body></html>" }));
    await server.listen(0);

    const page = await fetch(new URL("/", server.resolvedUrls!.local[0]), { headers: { accept: "text/html" } });
    const unknown = await fetch(new URL("/nope", server.resolvedUrls!.local[0]), { headers: { accept: "text/html" } });
    const html = await page.text();

    expect(html).toContain("<p>mine</p>");
    expect(html).toContain('<div id="root"></div>');
    expect([page.status, unknown.status]).toEqual([200, 404]);
    expect(await unknown.text()).toContain("<p>mine</p>");
  });

  it("will serve a public/ folder's index.html for its path without handle", async () => {
    const server = await serve(project({ "app/index.tsx": PAGE, "public/map/index.html": "map" }));
    await server.listen(0);
    const at = (path: string, method = "GET") => fetch(new URL(path, server.resolvedUrls!.local[0]), { method, headers: { accept: "text/html" } });

    expect(await (await at("/map/")).text()).toBe("map");
    expect(await (await at("/map")).text()).toBe("map");
    expect((await at("/map/", "HEAD")).status).toBe(200);
    expect((await at("/nope")).status).toBe(404);
  });

  it("will answer every navigation with the shell as 200 in a single-file project", async () => {
    const server = await serve(project({ "app.tsx": "export default () => null" }));
    await server.listen(0);

    const page = await fetch(new URL("/deep/link", server.resolvedUrls!.local[0]), { headers: { accept: "text/html" } });

    expect([page.status, page.headers.get("vary")]).toEqual([200, "Accept"]);
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

  it("will rescan page routes after a change under app/, and after a scan that failed", async () => {
    const root = realpathSync(project({ "app/index.tsx": PAGE }));
    const server = await serve(root);
    await server.listen(0);
    const status = async (path: string) => (await fetch(new URL(path, server.resolvedUrls!.local[0]), { headers: { accept: "text/html" } })).status;

    expect(await status("/about")).toBe(404);

    writeFileSync(join(root, "app/(about).tsx"), "export function Page( {");
    server.watcher.emit("add", join(root, "app/(about).tsx"));
    expect(await status("/about")).toBe(500);

    writeFileSync(join(root, "app/(about).tsx"), PAGE);
    expect(await status("/about")).toBe(200);
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

  it("builds the node service for a single-file project, with no page patterns", async () => {
    const { server } = await buildBoth({ "app.tsx": "export default () => <h1>hi</h1>" }, { assetsDir: "static/" });

    expect(server).toContain('from "@expressive/dev/server"');
    expect(server).toContain(`pages: { "assetsDir": "static" }`);
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
    "app/remote.ts": `
      import { Current, Unauthorized } from "@expressive/rpc";
      export default () => { if ((globalThis.hostCurrent ?? Current).get().request.headers.has("x-deny")) throw new Unauthorized("Sign in"); };
    `,
    "app/shop/index.tsx": "import { price } from './remote'; export const Page = () => price",
    "app/shop/remote.ts": "export async function price() { return 3; }",
    "app/tally/index.tsx": "import { add, bound } from './remote'; export const Page = () => [add, bound]",
    "app/tally/remote.ts": `${SIDECAR}
      import { Current } from "@expressive/rpc";
      export async function bound() { return ((globalThis.hostCurrent ?? Current).get().env as any).NAME; }
    `,
    "public/robots.txt": "robots",
    "public/map/index.html": "map",
    "api/[id].ts": `import { Current } from "@expressive/rpc"; export const GET = () => (((globalThis as any).hostCurrent ?? Current).get().params);`,
  };

  const post = (path: string, name: string, body: string, deny = false) =>
    new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-expressive-call": name, ...(deny && { "x-deny": "1" }) }, body });

  it("builds the fetch entry: settings, remotes, gates and named exports composed, host's value exported, every dependency bundled", async () => {
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
    const denied = await handler.fetch(post("/shop", "price", "[]", true), env, ctx);
    expect([denied.status, await denied.json()]).toEqual([401, expect.objectContaining({ message: "Sign in" })]);
    expect(await (await handler.fetch(post("/tally", "bound", "[]"), env, ctx)).json()).toEqual({ value: "prod" });
    expect((await handler.fetch(post("/tally", "add", "[10, 0]"), env, ctx)).status).toBe(409);
    expect(await (await handler.fetch(new Request("http://localhost/hello"), env, ctx)).json()).toEqual({ name: "prod" });
    expect(await (await handler.fetch(new Request("http://localhost/api/7"), env, ctx)).json()).toEqual({ id: "7" });
    expect((await handler.fetch(new Request("http://localhost/api/7/x", { headers: { accept: "text/html" } }), env, ctx)).status).toBe(404);
    expect((await handler.fetch(new Request("http://localhost/"), env, ctx)).headers.get("x-handled")).toBe("1");

    const ASSETS = { fetch: async (request: Request) => new URL(request.url).pathname === "/200.html" ? new Response("shell") : new Response(null, { status: 404 }) };
    const page = (path: string) => handler.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), { ...env, ASSETS }, ctx);

    expect([(await page("/shop")).status, (await page("/nope")).status, await (await page("/nope")).text()]).toEqual([200, 404, "shell"]);
    expect(Object.keys(handler).sort()).toEqual(["cron", "fetch"]);
    expect(handler.cron(env)).toEqual(["prod", "function"]);
    expect(Object.keys(named)).toEqual(["Counter"]);
    expect([...new Set(imports)].sort()).toEqual(["node:async_hooks", "node:crypto"]);
    expect(code).not.toContain("createServer");
  });

  it("builds the fetch entry from index.ts alone, bundling neither index.dev.ts's imports, node:fs, nor router or dom code", async () => {
    const root = project({
      "index.ts": `
        import { config } from "@expressive/dev";
        export default config({ target: "fetch", handle: ({ env }) => Response.json({ same: env === (globalThis as any).hostEnv }) });
      `,
      "index.dev.ts": `
        import settings from "./index.ts";
        import { open } from "./local";
        settings.env = () => ({ DB: open() });
        export default settings;
      `,
      "local.ts": `import { readFileSync } from "node:fs"; export const open = () => ["index-dev-only", readFileSync];`,
      "app/index.tsx": PAGE,
      "node_modules/@expressive/dev/package.json": JSON.stringify({ name: "@expressive/dev", type: "module", exports: "./index.js" }),
      "node_modules/@expressive/dev/index.js": "export const config = settings => settings;",
    });
    const quiet = (config: InlineConfig) => ({ ...config, configFile: false as const, logLevel: "silent" as const, resolve: SOURCES });

    await build(quiet(clientBuild(root)));
    await build(quiet(serverBuild(root)));

    const dir = join(root, "dist/server");
    const code = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(file => /\.m?js$/.test(file)).map(file => readFileSync(join(dir, file), "utf8")).join("\n");
    const imports = [...code.matchAll(/from\s*"([^"]+)"|import\s*"([^"]+)"/g)].map(([, a, b]) => a ?? b).filter(spec => !spec.startsWith("./"));
    const { default: handler } = await import(join(dir, "index.js"));
    const env = ((globalThis as any).hostEnv = { NAME: "prod" });

    expect(await (await handler.fetch(new Request("http://localhost/"), env)).json()).toEqual({ same: true });
    expect([...new Set(imports)].sort()).toEqual(["node:async_hooks", "node:crypto"]);
    expect(code).not.toContain("index-dev-only");
    expect(code).toMatch(/\/\/#region \S*rpc\/src\//);
    expect(code).not.toMatch(/node:(fs|path|util)/);
    expect(code).not.toMatch(/\/\/#region \S*(router|dom|env)\/src\/|\/\/#region \S*dev\/src\/client\//);
    delete (globalThis as any).hostEnv;
  });

  it("builds the fetch entry answering calls under a non-root base", async () => {
    const root = project({
      "index.ts": `export default { target: "fetch", remote: { opaque: false } };`,
      "app/index.tsx": PAGE,
      "app/blog/[slug]/index.tsx": "import { add } from './remote'; export const Page = () => add",
      "app/blog/[slug]/remote.ts": SIDECAR,
    });
    const quiet = (config: InlineConfig) => ({ ...config, base: "/app/", configFile: false as const, logLevel: "silent" as const, resolve: SOURCES });

    await build(quiet(clientBuild(root)));
    await build(quiet(serverBuild(root)));

    const { default: handler } = await import(join(root, "dist/server/index.js"));

    expect(await (await handler.fetch(post("/app/blog/hello", "add", "[2, 3]"))).json()).toEqual({ value: 5 });
    expect((await handler.fetch(post("/blog/hello", "add", "[2, 3]"))).status).toBe(404);
  });

  it("will fail a build and the dev server on a 0.5 setting or a bindings export, by name", async () => {
    const quiet = (config: InlineConfig) => ({ ...config, configFile: false as const, logLevel: "silent" as const, resolve: SOURCES });
    const old = project({ "index.ts": "export default { around: (next: any) => next() };", "app/index.tsx": PAGE });
    const bindings = project({ "index.ts": "export const bindings = () => ({}); export default {};", "app/index.tsx": PAGE });
    const misplaced = project({ "index.ts": "export default { env: () => ({}) };", "index.dev.ts": "export default {};", "app/index.tsx": PAGE });
    const host = expressive();

    await expect(build(quiet(serverBuild(old)))).rejects.toThrow("`fetch` and `around` became `handle`.");
    await expect(build(quiet(clientBuild(misplaced)))).rejects.toThrow("index.ts: `env` is set in index.dev.ts, never index.ts.");
    await serve(bindings, host);
    await expect(host.api!.config()).rejects.toThrow("`bindings` became `settings.env`, set in index.dev.ts.");
  });

  it("will run handle in dev around calls, pages and public files, but not Vite's own requests", async () => {
    (globalThis as any).hostCurrent = Current;
    (globalThis as any).handled = [];
    const root = project(FETCH);
    const server = await serve(root);
    const error = vi.spyOn(server.config.logger, "error").mockImplementation(() => {});
    await server.listen(0);
    const at = (path: string) => new URL(path, server.resolvedUrls!.local[0]);
    const call = (headers: Record<string, string> = {}) => fetch(at("/tally"), { method: "POST", headers: { "content-type": "application/json", "x-expressive-call": "add", ...headers }, body: "[1, 2]" });

    await server.transformRequest("/app/tally/remote.ts");

    const added = await call();
    const refused = await call({ "x-fail": "1" });
    const shell = await fetch(at("/invite/abc"), { headers: { accept: "text/html" } });
    const missing = await fetch(at("/missing.json"));

    expect(await added.json()).toEqual({ value: 3 });
    expect(added.headers.get("x-handled")).toBe("1");
    expect([refused.status, (await refused.json()).message]).toEqual([500, "no session"]);
    expect(await (await fetch(at("/hello"))).json()).toEqual({ name: null });
    expect(await shell.text()).toMatch(/\/@vite\/client[^]*<div id="root"><\/div>/);
    expect([shell.status, shell.headers.get("x-handled")]).toEqual([404, "1"]);
    expect((await fetch(at("/shop"), { headers: { accept: "text/html" } })).status).toBe(200);
    expect(await (await fetch(at("/robots.txt"))).text()).toBe("robots");
    expect(await (await fetch(at("/map/"), { headers: { accept: "text/html" } })).text()).toBe("map");
    expect([missing.status, missing.headers.get("x-handled"), missing.headers.has("x-expressive-fell")]).toEqual([404, "1", false]);

    for (const path of ["/@vite/client", "/app/index.tsx", "/index.ts?import", "/.expressive/main.tsx"]) await fetch(at(path));

    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("waitUntil: Error: late"));
    expect((globalThis as any).handled.splice(0)).toEqual(["/tally", "/tally", "/invite/abc", "/missing.json", "/hello", "/shop", "/robots.txt", "/map/"]);
    delete (globalThis as any).hostCurrent;
    delete (globalThis as any).handled;
  });

  it("will skip handle outside base, under a proxy, for Vite's flags and for source files outside public/", async () => {
    const root = realpathSync(project({
      "index.ts": "export default { handle({ request }: any) { ((globalThis as any).handled ??= []).push(new URL(request.url).pathname + new URL(request.url).search); return new Response('handled'); } };",
      "app/index.tsx": PAGE,
      "public/robots.txt": "robots",
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

    for (const path of ["/outside", "/proxied/a", "/re/b", "/base/src/util.ts", "/base/x?url", "/base/x?raw=", "/base/robots.txt", "/base/x?url=https://a", "/base/%E0", "/base/page"])
      await fetch(origin + path).catch(() => {});

    expect((globalThis as any).handled.splice(0)).toEqual(["/base/robots.txt", "/base/x?url=https://a", "/base/%E0", "/base/page"]);
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

  it("will pass a shell that fails to transform under handle to Vite's error handler, or log it under a reply of handle's own", async () => {
    const boom = { name: "boom", transformIndexHtml() { throw new Error("boom"); } };
    const server = await createServer({
      root: project({ "index.ts": "export default { async handle({ request, next }: any) { const reply = await next(); if (request.headers.has('x-own')) return new Response('own'); } };", "app/index.tsx": PAGE }),
      configFile: false,
      logLevel: "silent",
      plugins: [expressive(), boom],
      resolve: SOURCES,
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { watch: null },
    });
    servers.push(server);
    await server.listen(0);

    const error = vi.spyOn(server.config.logger, "error").mockImplementation(() => {});

    expect((await fetch(new URL("/", server.resolvedUrls!.local[0]), { headers: { accept: "text/html" } })).status).toBe(500);
    expect(await (await fetch(new URL("/", server.resolvedUrls!.local[0]), { headers: { accept: "text/html", "x-own": "1" } })).text()).toBe("own");
    expect(error).toHaveBeenCalledWith("Error: boom");
  });

  it("will serve Vite's own requests while index.ts fails its check", async () => {
    const server = await serve(project({ "index.ts": "export default { around: (next: any) => next() };", "app/index.tsx": PAGE }));
    await server.listen(0);
    const at = (path: string) => new URL(path, server.resolvedUrls!.local[0]);

    expect((await fetch(at("/@vite/client"))).status).toBe(200);
    expect((await fetch(at("/"), { headers: { accept: "text/html" } })).status).toBe(500);
  });

  it("will run folder gates under the fetch target in dev", async () => {
    const server = await serve(project({
      "index.ts": `export default { target: "fetch" };`,
      "app/index.tsx": PAGE,
      "app/remote.ts": "export default () => {}",
      "app/shop/remote.ts": `export default () => { throw new Error("Sign in"); }; export async function price() { return 3; }`,
      "app/tally/remote.ts": "export async function add(a: number, b: number) { return a + b; }",
    }));
    await server.listen(0);
    const call = async (at: string, name: string, body: string) => {
      const res = await fetch(new URL(at, server.resolvedUrls!.local[0]), { method: "POST", headers: { "content-type": "application/json", "x-expressive-call": name }, body });
      return [res.status, await res.json()];
    };

    await server.transformRequest("/app/shop/remote.ts");
    await server.transformRequest("/app/tally/remote.ts");

    expect(await call("/tally", "add", "[2, 3]")).toEqual([200, { value: 5 }]);
    expect(await call("/shop", "price", "[]")).toEqual([500, expect.objectContaining({ message: "Sign in" })]);
  });

  describe("api/", () => {
    const RPC = "const { Current, Forbidden } = (globalThis as any).hostRpc;";

    const API = {
      "app/index.tsx": PAGE,
      "api/hello.ts": "export const GET = () => ({ hello: 'world' }); export type Hello = { hello: string };",
      "api/echo.ts": `${RPC} export async function POST() { return { echo: await Current.get().json() }; }`,
      "api/photo/[id].ts": `${RPC} export const GET = () => Current.get().params;`,
      "api/legacy/[...].ts": "export default () => (request: Request) => Response.json({ path: new URL(request.url).pathname });",
      "api/admin/index.ts": `${RPC} export default () => { if (!Current.get().request.headers.has('x-admin')) throw new Forbidden('Admins only.'); };`,
      "api/admin/me.ts": "export const GET = () => 'root';",
    };

    beforeAll(async () => {
      (globalThis as any).hostRpc = await import("@expressive/rpc");
    });

    it("will serve api/ routes in dev on the module runner, without handle", async () => {
      const root = realpathSync(project(API));
      const server = await serve(root);
      await server.listen(0);

      const at = (path: string, init?: RequestInit) => fetch(new URL(path, server.resolvedUrls!.local[0]), init);
      const refused = await at("/api/hello", { method: "POST" });
      const missing = await at("/api/nope", { headers: { accept: "text/html" } });

      expect(await (await at("/api/hello")).json()).toEqual({ hello: "world" });
      expect(await (await at("/api/echo", { method: "POST", headers: { "content-type": "application/json" }, body: '{"a":1}' })).json()).toEqual({ echo: { a: 1 } });
      expect(await (await at("/api/photo/a%20b")).json()).toEqual({ id: "a b" });
      expect([refused.status, refused.headers.get("allow")]).toEqual([405, "GET, HEAD"]);
      expect(await (await at("/api/legacy/x/y")).json()).toEqual({ path: "/api/legacy/x/y" });
      expect([(await at("/api/admin/me")).status, await (await at("/api/admin/me", { headers: { "x-admin": "1" } })).text()]).toEqual([403, "root"]);
      expect([missing.status, missing.headers.get("content-type"), (await missing.json()).message]).toEqual([404, "application/json", "No route in api/ serves /api/nope - paths under /api belong to api/."]);
      expect((await at("/api/hello.ts")).status).toBe(404);

      writeFileSync(join(root, "api/late.ts"), "export const GET = () => 'late';");
      server.watcher.emit("add", join(root, "api/late.ts"));
      server.watcher.emit("add", join(root, "elsewhere.ts"));
      expect(await (await at("/api/late")).text()).toBe("late");

      writeFileSync(join(root, "api/(group).ts"), "export const GET = () => 1;");
      server.watcher.emit("add", join(root, "api/(group).ts"));
      const broken = await at("/api/hello");

      expect([broken.status, (await broken.json()).message]).toEqual([500, "api/(group).ts: api/ has no groups - name it group.ts."]);
    });

    it("will leave /api to the app without an api/ folder", async () => {
      const server = await serve(project({ "app/index.tsx": PAGE }));
      await server.listen(0);

      const reply = await fetch(new URL("/api/hello", server.resolvedUrls!.local[0]), { headers: { accept: "text/html" } });

      expect([reply.status, reply.headers.get("content-type")]).toEqual([404, "text/html"]);
    });

    it("will fail the dev server and the build when something else would serve /api", async () => {
      const files = { "app/index.tsx": PAGE, "api/hello.ts": "export const GET = () => 1;", "public/api/x.txt": "" };

      await expect(serve(project(files))).rejects.toThrow("public/api would serve /api, which belongs to the api/ folder - move it.");
      await expect(buildBoth(files)).rejects.toThrow("public/api would serve /api");
    });

    it("will throw if client code imports from api/, but not crawl it for dependencies", async () => {
      const root = project({
        "app/index.tsx": "import 'client-dep'; import { GET } from '../api/hello'; import { api } from '../lib/api'; export const Page = () => [GET, api]",
        "lib/api.ts": "export const api = '/api';",
        "api/hello.ts": "import { db } from 'server-only-dep'; export const GET = () => db;",
        "node_modules/client-dep/package.json": `{ "name": "client-dep", "type": "module", "main": "index.js" }`,
        "node_modules/client-dep/index.js": "export default 1;",
      });
      const config = await resolveConfig({ root, configFile: false, logLevel: "silent", plugins: [expressive()], resolve: SOURCES }, "serve");
      const server = await serve(root);

      expect((await optimizeDeps(config, true)).optimized).toHaveProperty("client-dep");
      await expect(server.transformRequest("/app/index.tsx")).rejects.toThrow("app/index.tsx imports api/hello.ts - api/ is server-only; fetch its route, or move what both need outside api/.");
      expect((await server.environments.ssr.transformRequest("/app/index.tsx"))?.code).toContain("/api/hello.ts");
    });

    it("will throw if client code imports api/ through an alias", async () => {
      const root = project({ "app/index.tsx": "import { GET } from '@routes/hello'; export const Page = () => GET", "api/hello.ts": "export const GET = () => 1;" });
      const server = await serve(root, expressive(), { alias: [{ find: /^@routes\/(.*)$/, replacement: `${root}/api/$1` }, ...(SOURCES!.alias as any[])] });

      await expect(server.transformRequest("/app/index.tsx")).rejects.toThrow("api/ is server-only");
    });

    it("will refuse in dev a route whose exports break the rules as it loads, and log a save's errors", async () => {
      const root = realpathSync(project({ "app/index.tsx": PAGE, "api/hello.ts": "export const helper = () => {};", "api/ok.ts": "export const GET = () => 1;" }));
      const server = await serve(root);
      const logged = vi.spyOn(server.config.logger, "error").mockImplementation(() => {});
      const console_ = vi.spyOn(console, "error").mockImplementation(() => {});
      await server.listen(0);

      const reply = await fetch(new URL("/api/hello", server.resolvedUrls!.local[0]));
      const message = "api/hello.ts: `helper` is not a route export - export GET, POST, PUT, PATCH, DELETE, OPTIONS or a default, and keep helpers outside api/. No handler - export GET, POST, PUT, PATCH, DELETE, OPTIONS or a default.";

      expect([reply.status, (await reply.json()).message]).toEqual([500, message]);

      server.watcher.emit("change", join(root, "elsewhere.ts"));
      server.watcher.emit("change", join(root, "api/hello.ts"));
      await vi.waitFor(() => expect(logged).toHaveBeenCalledWith(message));

      writeFileSync(join(root, "api/ok.ts"), "export const GET = (");
      server.watcher.emit("change", join(root, "api/ok.ts"));
      await vi.waitFor(() => expect(logged).toHaveBeenCalledTimes(2));

      console_.mockRestore();
    });

    it("builds the node service with the api/ table, and fails the build on a module that breaks the rules", async () => {
      const { client, server } = await buildBoth({ ...API, "app/index.tsx": PAGE });

      expect(server).toMatch(/api: \{\s*prefix: "\/api",\s*routes: \[/);
      expect(server).toMatch(/name: "api\/photo\/\[id\]\.ts",\s*path: \["photo", ":id"\],\s*index: false,\s*module: /);
      expect(server).toContain("Admins only.");
      expect(client).not.toContain("Admins only.");
      await expect(buildBoth({ "app/index.tsx": PAGE, "api/hello.ts": "export const helper = 1;" })).rejects.toThrow("api/hello.ts: `helper` is not a route export");
    });

    it("builds the node service without an api/ table when there is no api/ folder", async () => {
      const { server } = await buildBoth({ "app/index.tsx": PAGE });

      expect(server).not.toContain("api:");
    });
  });

  it("will salt ids when index.ts has no default", async () => {
    const config = clientBuild(project({ "app/index.tsx": PAGE, "index.ts": "export const port = 1;" }), { write: false });
    config.configFile = false;
    config.logLevel = "silent";
    config.resolve = SOURCES;

    await expect(build(config)).resolves.toBeDefined();
  });
});

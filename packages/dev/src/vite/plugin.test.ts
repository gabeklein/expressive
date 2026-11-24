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

  const GATED = `
    ${HOST}
    export default class Tally extends Model {
      static ttl = 60;
      total = 0;
      async add(by: number) { return (this.total += by); }
    }
    export async function peek() { return Tally.get().total; }
  `;

  it("will keep a remote default off the browser's stub - it gates the folder on the server", async () => {
    const root = project({ "app/index.tsx": PAGE, "app/tally/index.tsx": "import { peek } from './remote'; export const Page = () => peek", "app/tally/remote.ts": GATED });
    const server = await serve(root);

    const stub = (await server.transformRequest("/app/tally/remote.ts"))?.code;
    expect(stub).toContain('export const peek = (...args) => call(at, "peek", args);');
    expect(stub).not.toContain("export default");
    expect(stub).not.toContain("this.total");
  });

  it("will throw if a remote default's base cannot be followed", async () => {
    const root = project({ "app/index.tsx": PAGE, "app/tally/remote.ts": `const mixin = (B: any) => B; ${HOST} export default class Tally extends mixin(Model) {}` });
    const server = await serve(root);

    await expect(server.transformRequest("/app/tally/remote.ts")).rejects.toThrow("Tally extends an expression");
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

    expect(await (await post("peek")).json()).toEqual({ value: 0 });
    expect((await post("default.add", "[2]")).status).toBe(404);
  });

  it("will gate the calls below a folder by its default, imported by the client or not", async () => {
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
      headers: { "content-type": "application/json", "x-expressive-call": "site" },
      body: "[]",
    });

    expect(await res.json()).toEqual({ value: "site" });
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

  it("will serve the browser a call module of rpc's client", async () => {
    const server = await serve(project({ "app/index.tsx": PAGE }));

    expect((await server.transformRequest("/.expressive/call.ts"))?.code).toMatch(/export \{ call, define \} from "[^"]*rpc[^"]*"/);
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

  it("builds the node service with each folder's gate", async () => {
    const { server } = await buildBoth({
      "index.ts": "export default { remote: { opaque: false } };",
      "app/index.tsx": PAGE,
      "app/base.ts": `${HOST} export class Base extends Model {}`,
      "app/remote.ts": `import { Base } from "./base"; export default class Site extends Base {}`,
      "app/tally/index.tsx": "import { peek } from './remote'; export const Page = () => peek",
      "app/tally/remote.ts": GATED,
    });

    expect(server).toMatch(/seats: \[\{\s*pattern: \[\],\s*Type: Site\s*\}, \{\s*pattern: \["tally"\],\s*Type: Tally\s*\}\]/);
  });

  it("will check every remote entry's default at build, imported by the client or not", async () => {
    const files = (index: string, remote: string) => ({ "index.ts": index, "app/index.tsx": PAGE, "app/remote.ts": remote });
    const fetchTarget = `export default { target: "fetch" };`;

    await expect(buildBoth(files(fetchTarget, `${HOST} export default class Site extends Model {}`))).rejects.toThrow("app/remote.ts: Its default is a gate, which the fetch target does not run");
    await expect(buildBoth(files("export default {};", "export default class Site extends Error {}"))).rejects.toThrow("Site extends Error, which is neither declared nor imported");
    await expect(buildBoth(files("export default {};", "export default () => true;"))).rejects.toThrow("A remote default is its folder's gate");
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

  it("builds the node service with index.ts as its config", async () => {
    const { server } = await buildBoth({ "app/index.tsx": PAGE, "index.ts": "export default { port: 4000 };" });

    expect(server).toContain('from "@expressive/dev/server"');
    expect(server).toMatch(/port: 4(000|e3)/);
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
      export async function bindings() { return (await import("./local")).local(); }
      export { Counter } from "./counter";
      export default {
        target: "fetch",
        port: 8080,
        remote: { opaque: false },
        around(next: () => Promise<unknown>, { request, env }: { request: Request; env: any }) {
          ((globalThis as any).around ??= []).push(\`\${new URL(request.url).pathname} \${env.NAME}\`);
          return request.headers.has("x-fail") ? Promise.reject(new Error("no session")) : next();
        },
        async fetch(request: Request, env: any, ctx: any) {
          ctx.waitUntil(Promise.reject(new Error("late")));
          if (new URL(request.url).pathname === "/hello") return (await import("./hello")).hello(env);
        },
        cron(env: any) { return env.NAME; },
      };
    `,
    "hello.ts": `
      import { Current } from "@expressive/rpc";
      export const hello = (env: any) => Response.json({ name: env.NAME, path: (globalThis.hostCurrent ?? Current).get().url.pathname });
    `,
    "counter.ts": "export class Counter {}",
    "local.ts": `import { readFileSync } from "node:fs"; export const local = () => ({ NAME: typeof readFileSync == "function" ? "dev-only-binding" : "" });`,
    "app/index.tsx": PAGE,
    "app/shop/index.tsx": "import { price } from './remote'; export const Page = () => price",
    "app/shop/remote.ts": "export async function price() { return 3; }",
    "app/tally/index.tsx": "import { add, bound } from './remote'; export const Page = () => [add, bound]",
    "app/tally/remote.ts": `${SIDECAR}
      import { Current } from "@expressive/rpc";
      export async function bound() { return ((globalThis.hostCurrent ?? Current).get().env as any).NAME; }
    `,
  };

  const post = (path: string, name: string, body: string) =>
    new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-expressive-call": name }, body });

  it("builds the fetch entry: the app's config, remotes and named exports wired to fetchHandler, every dependency bundled", async () => {
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
    expect(await (await handler.fetch(new Request("http://localhost/hello"), env, ctx)).json()).toEqual({ name: "prod", path: "/hello" });
    expect(Object.keys(handler).sort()).toEqual(["cron", "fetch"]);
    expect(handler.cron(env)).toBe("prod");
    expect(Object.keys(named)).toEqual(["Counter"]);
    expect([...new Set(imports)].sort()).toEqual(["node:async_hooks", "node:crypto"]);
    expect(code).not.toContain("dev-only-binding");
    expect(code).not.toContain("createServer");
  });

  it("will run the app's fetch in dev with its bindings, after calls and before Vite", async () => {
    (globalThis as any).hostCurrent = Current;
    (globalThis as any).around = [];
    const server = await serve(project(FETCH));
    const error = vi.spyOn(server.config.logger, "error").mockImplementation(() => {});
    await server.listen(0);
    const at = (path: string) => new URL(path, server.resolvedUrls!.local[0]);

    await server.transformRequest("/app/tally/remote.ts");

    const bound = await fetch(at("/tally"), { method: "POST", headers: { "content-type": "application/json", "x-expressive-call": "bound" }, body: "[]" });

    const refused = await fetch(at("/tally"), { method: "POST", headers: { "content-type": "application/json", "x-expressive-call": "bound", "x-fail": "1" }, body: "[]" });

    expect(await bound.json()).toEqual({ value: "dev-only-binding" });
    expect([refused.status, (await refused.json()).message]).toEqual([500, "no session"]);
    expect(await (await fetch(at("/hello"))).json()).toEqual({ name: "dev-only-binding", path: "/hello" });
    expect(await (await fetch(at("/"), { headers: { accept: "text/html" } })).text()).toContain('<div id="root"></div>');
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("waitUntil: Error: late"));
    expect((globalThis as any).around.splice(0)).toEqual(["/tally dev-only-binding", "/tally dev-only-binding", "/hello dev-only-binding", "/ dev-only-binding"]);
    delete (globalThis as any).hostCurrent;
    delete (globalThis as any).around;
  });

  it("will retry dev bindings that failed, and give a Node app's fetch none", async () => {
    const root = project({
      "index.ts": `
        let tries = 0;
        export function bindings() { if (!tries++) throw new Error("not yet"); return { NAME: "dev" }; }
        export default { target: "fetch", fetch: async (_: Request, env: any) => Response.json(env.NAME) };
      `,
      "app/index.tsx": PAGE,
    });
    const server = await serve(root);
    await server.listen(0);
    const at = new URL("/name", server.resolvedUrls!.local[0]);

    expect((await fetch(at)).status).toBe(500);
    expect(await (await fetch(at)).json()).toBe("dev");

    const node = await serve(project({ "index.ts": `export default { fetch: async (_: Request, env: any) => Response.json(env) };`, "app/index.tsx": PAGE }));
    await node.listen(0);

    expect(await (await fetch(new URL("/name", node.resolvedUrls!.local[0]))).json()).toEqual({});
  });

  it("will give the app's fetch in dev a public file, else the transformed shell, as next", async () => {
    const server = await serve(project({
      "index.ts": `export default { fetch: async (request: Request, env: unknown, ctx: unknown, next: () => Promise<Response>) => new URL(request.url).pathname.startsWith("/@") ? undefined : next() };`,
      "public/robots.txt": "robots",
      "app/index.tsx": PAGE,
    }));
    await server.listen(0);
    const at = (path: string) => new URL(path, server.resolvedUrls!.local[0]);

    const page = await fetch(at("/invite/abc"));

    expect(page.headers.get("content-type")).toBe("text/html");
    expect(await page.text()).toMatch(/\/@vite\/client[^]*<div id="root"><\/div>/);
    expect(await (await fetch(at("/robots.txt"))).text()).toBe("robots");
  });

  it("will refuse a remote default under the fetch target, imported or not, and bind nothing without bindings()", async () => {
    const index = `export default { target: "fetch", fetch: async (_: Request, env: any) => Response.json(env) };`;
    const server = await serve(project({
      "index.ts": index,
      "app/index.tsx": PAGE,
      "app/base.ts": `${HOST} export class Base extends Model {}`,
      "app/remote.ts": `import { Base } from "./base"; export default class Site extends Base {}`,
      "app/shop/remote.ts": "export async function price() { return 3; }",
      "app/tally/remote.ts": GATED,
    }));
    await server.listen(0);

    expect(await (await fetch(new URL("/env", server.resolvedUrls!.local[0]))).json()).toEqual({});

    await expect(server.transformRequest("/app/tally/remote.ts")).rejects.toThrow("app/tally/remote.ts: Its default is a gate, which the fetch target does not run");

    await server.transformRequest("/app/shop/remote.ts");
    const res = await fetch(new URL("/shop", server.resolvedUrls!.local[0]), { method: "POST", headers: { "content-type": "application/json", "x-expressive-call": "price" }, body: "[]" });

    expect([res.status, (await res.json()).message]).toEqual([500, expect.stringContaining("app/remote.ts: Its default is a gate")]);
  });

  it("will salt ids when index.ts has no default", async () => {
    const config = clientBuild(project({ "app/index.tsx": PAGE, "index.ts": "export const port = 1;" }), { write: false });
    config.configFile = false;
    config.logLevel = "silent";
    config.resolve = SOURCES;

    await expect(build(config)).resolves.toBeDefined();
  });
});

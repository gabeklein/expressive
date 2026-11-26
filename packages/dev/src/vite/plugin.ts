import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServerModuleRunner, runnerImport, type Plugin, type Rollup, type UserConfig, type ViteDevServer } from "vite";
import type { ModuleRunner } from "vite/module-runner";

import type { Settings } from "../settings";
import { owns, type Api, type ApiRoute } from "../server/api";
import { check } from "../server/check";
import { compose, routed, type Pages } from "../server/compose";
import { layered } from "../server/env";
import { GENERATED, SHELL, bootstrap, ensureBootstrap, importRel, prerenderEntry, PRERENDER_CALL, PRERENDER_ENTRY, resolveProject, fetchEntry, serverEntry, type Project } from "./project";
import { Exposure, type Exposed } from "./remote";
import { CALL, generateRoutes, pagePatterns, remoteEntries, remoteOf, staticPaths, type ExportScanner, type Remote, type Scan } from "./routes";
import { isCall, send, toRequest } from "@expressive/rpc/http";
import { verify, type Endpoint, type Seats } from "@expressive/rpc/protocol";
import { SCRIPT, guardScript, type Sources } from "@expressive/rpc/vite";
import { staticFile } from "../server/listen";
import { install } from "../server/install";
import { hasGate, scanExports, scanGate, scanRemote } from "./scan";
import { apiErrors, helperAt, leafOf, reservedApi, scanApi, verifyApi, type ApiHelper } from "./api";

const MAIN = "main.tsx";
const ROUTES = "routes.tsx";
const SERVER = "server.ts";
const PRERENDER = "prerender.tsx";
const DOM_SERVER = "@expressive/dom/server";
const SETTINGS = "settings.ts";
const INDEX = "settings-index.ts";
const REMOTE_IMPORT = /(^|\/)remote(\/|\.[cm]?[jt]s$|$)/;

/** The plugin's API - `config()` loads the app's settings: `index.dev.ts`'s when it exists, else `index.ts`'s. */
export interface Host {
  config(): Promise<Settings>;
}

const DEPS = [
  "@expressive/mvc",
  "@expressive/mvc/hot",
  "@expressive/jsx",
  "@expressive/jsx/jsx-runtime",
  "@expressive/jsx/jsx-dev-runtime",
  "@expressive/dom",
  "@expressive/dom/jsx-runtime",
  "@expressive/dom/jsx-dev-runtime",
  "@expressive/router",
  "@expressive/rpc",
  "@expressive/dev",
  "@expressive/dev/jsx-runtime",
  "@expressive/dev/jsx-dev-runtime",
];

const HOSTED = ["@expressive/inspect/vite/client", "@expressive/inspect/install", "@expressive/inspect"];

const builds = new Map<string, Exposure>();

const BOOT = "index.js";

const boot = (app: string, dotenv: boolean) =>
  [`process.env.NODE_ENV ||= "production";`, dotenv && `(await import("@expressive/dev/server")).registerEnv();`, `await import(${JSON.stringify(`./${app}`)});`]
    .filter(Boolean)
    .join("\n") + "\n";

const SHARED = ["@expressive/mvc", "@expressive/jsx", "@expressive/dom", "@expressive/router", "@expressive/inspect", "@expressive/rpc", "@expressive/env", "@expressive/dev"];

/**
 * The app host as a Vite plugin, for a hand-written Vite config.
 *
 * Serves the virtual shell, entry and route tree under `/.expressive/`, and builds sidecars.
 * Add `inspect()` from `@expressive/inspect/vite` beside it for the dev relay.
 * The built server's `index.js` copies `.env` files into `process.env` before the app loads.
 */
export function expressive(): Plugin<Host> {
  return host(true);
}

export function host(dotenv: boolean): Plugin<Host> {
  let root = process.cwd();
  let project: Project;
  let generatedDir: string;
  let mainId: string;
  let routesId: string;
  let serverId: string;
  let prerenderId: string;
  let callId: string;
  let settingsId: string;
  let indexId: string;
  let htmlId: string;
  let apiDir: string;
  let apiPrefix: string;
  let vite: ViteDevServer | undefined;
  let layout: string | undefined;
  let runner: ModuleRunner | undefined;
  let exposure = new Exposure();
  let build: "client" | "server" | undefined;
  let prerendering = false;
  let settings: Settings | undefined;
  const scans = new Map<string, { source: string; scan: Scan }>();
  const scanRoute: ExportScanner = async (source, path) => {
    const hit = scans.get(path);
    if (hit?.source === source) return hit.scan;

    const scan = await scanExports(source, path);
    scans.set(path, { source, scan });
    return scan;
  };
  let routes: string | undefined;
  const generate = () => generateRoutes(project.appDir!, generatedDir, scanRoute);
  let assetsDir: string;
  let scanned: Promise<string[]> | undefined;
  const patterns = () => (project.appDir ? (scanned ??= pagePatterns(project.appDir, scanRoute).catch(error => ((scanned = undefined), Promise.reject(error)))) : undefined);
  const pages = async (): Promise<Pages> => ({ patterns: await patterns(), assetsDir });
  const pageStatus = async (pathname: string) => {
    const known = await patterns();
    return !known || routed(known, pathname) ? 200 : 404;
  };

  const generatedPath = (id: string, importer?: string) => {
    if (id.startsWith(`/${GENERATED}/`)) return join(root, id);
    if (importer?.startsWith(generatedDir) && id.startsWith(".")) return resolve(dirname(importer), id);

    return id;
  };

  const remoteAt = (file: string) => (project.appDir ? remoteOf(project.appDir, file) : undefined);

  const apiFiles = () => {
    if (!existsSync(apiDir)) return;

    const { problems, ...files } = scanApi(root, apiDir);

    if (problems.length) throw new Error(problems.join("\n"));
    return files;
  };

  const entries = () => [join(root, "index.ts"), join(root, "index.dev.ts")].map(file => existsSync(file) && file);

  const api: Host = {
    async config() {
      if (!runner) throw new Error("The dev server is not running.");

      const files = `${entries()}`;

      if (layout !== files) {
        const graph = vite!.environments.ssr.moduleGraph;

        for (const id of [settingsId, indexId]) {
          const mod = graph.getModuleById(id);
          if (mod) graph.invalidateModule(mod);
        }

        if (layout !== undefined) runner.evaluatedModules.clear();
        layout = files;
      }

      const { index, dev } = await runner.import(settingsId);

      if (index) check(index.before ?? {}, index.exports);
      if (dev) return check(dev.default, Object.keys(dev), "index.dev.ts");

      return index?.settings ?? {};
    },
  };

  const gateError = (remote: Remote) => {
    const { gate, problems } = scanGate(remote, readFileSync(remote.file, "utf8"));

    return { gate, error: problems.length ? `${relative(root, remote.file)}: ${problems.join(" ")}` : undefined };
  };

  const readShell = () =>
    project.htmlPath ? ensureBootstrap(readFileSync(project.htmlPath, "utf8")) : SHELL;

  return {
    name: "expressive",
    enforce: "pre",

    api,

    async config(user, env) {
      root = realpathSync(resolve(user.root ?? process.cwd()));
      project = resolveProject(root);
      build = env.command !== "build" ? undefined : env.isSsrBuild ? "server" : "client";
      prerendering = user.build?.rollupOptions?.input === PRERENDER_ENTRY;
      settings = build && (await buildConfig(project));

      const reserved = reservedApi(root);

      if (reserved.length) throw new Error(reserved.join("\n"));

      const entries = project.appDir
        ? ["app/**/*.{ts,tsx,js,jsx}", "!app/**/*.{spec,test}.*", "!app/**/remote.*", "!app/**/remote/**"]
        : [importRel(root, project.appPath!)];

      return {
        root,
        appType: "custom",
        oxc: { jsx: { runtime: "automatic", importSource: "@expressive/dev" } },
        optimizeDeps: { entries, include: DEPS },
        resolve: { alias: hosted() },
        environments: { ssr: { resolve: { external: SHARED } } },
        build: env.isSsrBuild || prerendering ? undefined : { rollupOptions: { input: project.htmlPath ?? join(root, "index.html") } },
        ...(build === "server" && settings!.target === "fetch" && FETCH),
      };
    },

    configResolved(config) {
      root = config.root;
      generatedDir = join(root, GENERATED);
      mainId = join(generatedDir, MAIN);
      routesId = join(generatedDir, ROUTES);
      serverId = join(generatedDir, SERVER);
      prerenderId = join(generatedDir, PRERENDER);
      callId = join(generatedDir, CALL);
      settingsId = join(generatedDir, SETTINGS);
      indexId = join(generatedDir, INDEX);
      htmlId = join(root, "index.html");
      apiDir = join(root, "api");
      apiPrefix = `${config.base}api`;
      assetsDir = config.build.assetsDir.replace(/\/+$/, "");
    },

    async buildStart() {
      if (build === "client") {
        const salt = settings!.remote?.opaque === false ? undefined : randomBytes(16).toString("base64url");
        builds.set(root, (exposure = new Exposure(salt)));

        for (const remote of project.appDir ? remoteEntries(project.appDir) : []) {
          const { gate, error } = gateError(remote);
          if (error) this.error(error);
          if (!gate) continue;

          const sources = sourcesOf(async (spec, importer) => (await this.resolve(spec, importer, { skipSelf: true }))?.id.split("?")[0]);
          const { problems, ...scanned } = await scanRemote(remote, readFileSync(remote.file, "utf8"), sources, remoteAt);

          if (problems.length) this.error(`${relative(root, remote.file)}: ${problems.join(" ")}`);

          exposure.modules.set(remote.file, { ...remote, ...scanned, calls: [] });
        }

        const errors = existsSync(apiDir) ? await apiErrors(root) : [];

        if (errors.length) this.error(errors.join("\n"));
      }

      if (build === "server") {
        const client = builds.get(root);
        if (!client) this.error("The server build needs the client build's remote calls - run the client build first.");
        exposure = client;
      }
    },

    async resolveId(id, importer, options) {
      const generated = generatedPath(id, importer);

      switch (generated) {
        case mainId:
        case routesId:
        case serverId:
        case prerenderId:
        case callId:
        case settingsId:
        case indexId:
          return generated;
      }

      if (id === htmlId && !existsSync(htmlId)) return htmlId;
      if (id === DOM_SERVER && importer === prerenderId) return this.resolve(id, fileURLToPath(import.meta.url), { skipSelf: true });

      if (options.ssr || !importer || !SCRIPT.test(importer.split("?")[0])) return;

      const named = REMOTE_IMPORT.test(id);

      if (!named && !existsSync(apiDir)) return;

      const resolved = await this.resolve(id, importer, { ...options, skipSelf: true });

      if (resolved?.id.startsWith(apiDir + sep)) {
        if ("scan" in options && options.scan) return { id: `\0${resolved.id}`, external: true };
        this.error(`${relative(root, importer)} imports ${relative(root, resolved.id)} - api/ is server-only; fetch its route, or move what both need outside api/.`);
      }

      const remote = named && resolved && remoteAt(resolved.id);

      if (!remote) return resolved;

      const from = importer.split("?")[0];

      if (!from.startsWith(remote.folder + sep) && !from.startsWith(generatedDir + sep))
        this.error(`${relative(root, importer)} imports ${relative(root, resolved.id)} - only modules in ${relative(root, remote.folder)}/ and below may call it.`);

      return "scan" in options && options.scan ? { id: `\0${resolved.id}`, external: true } : resolved;
    },

    async load(id, options) {
      const file = id.split("?")[0];
      const remote = !options?.ssr && remoteAt(file);

      if (remote) {
        const sources = sourcesOf(async (spec, importer) => (await this.resolve(spec, importer, { skipSelf: true }))?.id.split("?")[0]);
        const { problems, ...scanned } = await scanRemote(remote, readFileSync(file, "utf8"), sources, remoteAt);

        if (problems.length) this.error(`${relative(root, file)}: ${problems.join(" ")}`);

        const exposed = { ...remote, ...scanned };
        exposure.modules.set(file, exposed);

        return stub(exposure, exposed, remoteAt);
      }

      switch (id) {
        case callId:
          if (prerendering) return PRERENDER_CALL;

          return CALL_MODULE;
        case mainId:
          return bootstrap(project.appDir ? `./${ROUTES}` : importRel(generatedDir, project.appPath!));
        case routesId:
          return (routes = await generate());
        case serverId: {
          const api = { prefix: apiPrefix, routes: apiFiles()?.routes };

          return settings?.target === "fetch"
            ? fetchEntry(project, generatedDir, exposure, await namedExports(project), api, await pages(), gated(project))
            : serverEntry(project, generatedDir, exposure, gated(project), api, await pages());
        }
        case prerenderId: {
          if (!project.appDir) return prerenderEntry(importRel(generatedDir, project.appPath!), []);

          const { sources } = await staticPaths(project.appDir, scanExports);
          return prerenderEntry(`./${ROUTES}`, sources.map(file => importRel(generatedDir, file)));
        }
        case settingsId: {
          const [index, dev] = entries();

          return [index && `export * as index from "./${INDEX}";`, dev && `export * as dev from ${JSON.stringify(importRel(generatedDir, dev))};`].filter(Boolean).join("\n") + "\n";
        }
        case indexId:
          return [
            `import * as module from ${JSON.stringify(importRel(generatedDir, join(root, "index.ts")))};`,
            "export const exports = Object.keys(module);",
            "export const settings = module.default;",
            `export const before = settings && typeof settings == "object" ? { ...settings } : settings;`,
            "",
          ].join("\n");
        case htmlId:
          return project.htmlPath ? undefined : SHELL;
      }
    },

    async transform(code, id, options) {
      const path = id.split("?")[0];
      const problem = !options?.ssr && (await guardScript(code, path));

      if (problem) this.error(`${relative(root, path)} ${problem}`);
    },

    generateBundle(_options, bundle) {
      const entry = build === "server" && Object.values(bundle).find(chunk => (chunk as Rollup.OutputChunk).isEntry);

      if (!entry || entry.fileName === BOOT) return;

      this.emitFile({ type: "prebuilt-chunk", fileName: BOOT, code: boot(entry.fileName, dotenv) });
    },

    transformIndexHtml: {
      order: "pre",
      handler: html => ensureBootstrap(html),
    },

    configureServer(server) {
      vite = server;
      const host = (runner = createServerModuleRunner(server.environments.ssr));
      install();
      watchRoutes(server, project, routesId, async () => routes !== undefined && routes !== await generate(), () => (scanned = undefined));

      let table: { routes: ApiRoute[]; helpers: ApiHelper[] } | undefined;

      const tableOf = () => {
        const { routes, helpers } = apiFiles()!;

        return {
          helpers,
          routes: routes.map(({ file, ...route }) => ({
            ...route,
            async load() {
              const exports = await host.import(file);
              verifyApi(route, exports);
              return exports;
            },
          })),
        };
      };

      const routing: Api = {
        prefix: apiPrefix,
        routes: () => (table ??= tableOf()).routes,
        missing(segments, pathname) {
          const helper = helperAt((table ??= tableOf()).helpers, segments);
          return helper && `${helper.name} is a helper - rename it ${leafOf(helper.name)} to serve ${pathname}.`;
        },
      };

      const moved = (file: string) => file.startsWith(apiDir + sep) && (table = undefined);

      const saved = async (file: string) => {
        if (!file.startsWith(apiDir + sep)) return;

        try {
          for (const error of await apiErrors(root)) server.config.logger.error(error);
        } catch (error) {
          server.config.logger.error(`${error}`);
        }
      };

      server.watcher.add(apiDir);
      server.watcher.on("add", moved);
      server.watcher.on("unlink", moved);
      server.watcher.on("addDir", moved);
      server.watcher.on("unlinkDir", moved);
      server.watcher.on("add", saved);
      server.watcher.on("change", saved);
      server.watcher.on("change", file => {
        const remote = remoteAt(file);

        try {
          if (remote && !remote.module && hasGate(file)) server.ws.send({ type: "custom", event: "expressive:gates" });
        } catch {}
      });

      const endpoints = () => {
        const exposed = exposure.byPattern().map(group => endpointOf(host, root, exposure, group));
        const known = new Set(exposed.map(({ pattern }) => pattern.join("/")));
        const bare = gated(project).filter(({ pattern }) => !known.has(pattern.join("/")));

        return [...exposed, ...bare.map(remote => gateOnly(host, exposure, remote))];
      };
      const ctx = { waitUntil: (promise: Promise<unknown>) => void promise.catch(error => server.config.logger.error(`waitUntil: ${error}`)) };
      const shell = (url: string) => server.transformIndexHtml("/index.html", readShell(), url);
      const replayed = new WeakSet<object>();
      const skipped = skipList(server);

      const unbound = layered();
      let bound: ReturnType<typeof bindings> | undefined;

      const bindings = async (settings: Settings) => layered((await settings.env!()) ?? {});

      const view = (settings: Settings) => {
        if (!settings.env) return unbound;

        if (!bound) {
          const pending = (bound = bindings(settings));
          pending.catch(() => (bound = undefined));
        }

        return bound;
      };

      const gates: Seats = async pattern => {
        const remote = project.appDir && remoteEntries(project.appDir).find(remote => remote.pattern.join("/") === pattern.join("/"));

        if (!remote) return;

        const { gate, error } = gateError(remote);

        if (error) throw new Error(error);
        if (gate) return (await host.import(remote.file)).default;
      };

      server.middlewares.use(async (req, res, next) => {
        if (replayed.has(req)) return next();

        let pulled = false;
        const body = req[Symbol.asyncIterator].bind(req);
        const request = toRequest({ method: req.method, url: req.url, headers: req.headers, [Symbol.asyncIterator]: () => ((pulled = true), body()) }, res);

        try {
          const call = isCall(request);
          const owned = existsSync(apiDir) && owns(routing, new URL(request.url).pathname);

          if (!call && !owned && skipped(request)) return next();

          const settings = await api.config();

          if (!call && !owned && !settings.handle) return next();

          let fell: { request: Request; error?: unknown } | undefined;

          const assets = {
            async fetch(forward: Request) {
              const { pathname, search } = new URL(forward.url);
              const file = server.config.publicDir && staticFile(server.config.publicDir, pathname);
              const navigation = (forward.method === "GET" || forward.method === "HEAD") && !!forward.headers.get("accept")?.includes("text/html");

              if (file) return file;

              if (navigation)
                try {
                  return new Response(await shell(pathname + search), { status: await pageStatus(pathname), headers: { "content-type": "text/html", vary: "accept" } });
                } catch (error) {
                  fell = { request: forward, error };
                }

              fell ??= { request: forward };

              return new Response(null, { status: 404, headers: { [FELL]: "1" } });
            },
          };

          const app = compose(settings, { sidecars: endpoints, gates, api: existsSync(apiDir) ? routing : undefined, dev: true });
          const reply = await app(request, { env: await view(settings), ctx, assets });

          if (!fell || reply.status !== 404 || !reply.headers.has(FELL)) {
            if (fell?.error) server.config.logger.error(`${fell.error}`);
            return await send(res, unmarked(reply));
          }
          if (fell.error) return next(fell.error);

          reply.headers.forEach((value, name) => KEPT.has(name) || res.setHeader(name, value));
          if (reply.headers.has("set-cookie")) res.setHeader("set-cookie", reply.headers.getSetCookie());

          if (fell.request === request && !pulled) return next();

          const replay = await replica(req, fell.request);

          replayed.add(replay);
          server.middlewares(replay, res, () => {
            res.statusCode = 404;
            res.end();
          });
        } catch (error) {
          next(error);
        }
      });

      return () => {
        server.middlewares.use(async (req, res, next) => {
          const read = req.method === "GET" || req.method === "HEAD";
          const file = read && server.config.publicDir && staticFile(server.config.publicDir, new URL(req.url!, "http://x").pathname);

          if (!file && (req.method !== "GET" || !req.headers.accept?.includes("text/html"))) return next();

          try {
            if (file) return await send(res, file);

            const html = await shell(req.originalUrl!);
            res.statusCode = await pageStatus(new URL(req.originalUrl!, "http://x").pathname);
            res.setHeader("Content-Type", "text/html");
            res.setHeader("Vary", "Accept");
            res.end(html);
          } catch (error) {
            next(error);
          }
        });
      };
    },
  };
}

function watchRoutes(server: ViteDevServer, project: Project, routesId: string, stale: () => Promise<boolean>, changed: () => void) {
  const { appDir } = project;
  if (!appDir) return;

  server.watcher.add(appDir);

  const reload = () => {
    const mod = server.moduleGraph.getModuleById(routesId);
    if (mod) server.moduleGraph.invalidateModule(mod);
    server.ws.send({ type: "full-reload" });
  };

  const moved = (file: string) => {
    if (!file.startsWith(appDir)) return;

    changed();
    reload();
  };

  const edited = async (file: string) => {
    if (!file.startsWith(appDir)) return;

    changed();

    try {
      if (await stale()) reload();
    } catch {}
  };

  server.watcher.on("add", moved);
  server.watcher.on("unlink", moved);
  server.watcher.on("change", edited);
}

function hosted() {
  const alias: { find: string; replacement: string }[] = [];

  for (const find of HOSTED)
    try {
      alias.push({ find, replacement: fileURLToPath(import.meta.resolve(find)) });
    } catch {}

  return alias;
}

function endpointOf(host: ModuleRunner, root: string, exposure: Exposure, group: Exposed[]): Endpoint {
  return {
    pattern: group[0].pattern,
    exports: () => exposure.exports(group, file => host.import(file), (file, exports) => verify(relative(root, file), exports)),
  };
}

function gateOnly(host: ModuleRunner, exposure: Exposure, remote: Remote): Endpoint {
  return {
    pattern: remote.pattern,
    async exports() {
      const module = await host.import(remote.file);
      const errors = Object.entries(module).filter(([, value]) => typeof value == "function" && value.prototype instanceof Error);

      return { calls: {}, classes: Object.fromEntries(errors.map(([name, Type]) => [exposure.classId(remote, name), Type])) };
    },
  };
}

function gated(project: Project): Remote[] {
  if (!project.appDir) return [];

  return remoteEntries(project.appDir).filter(remote => hasGate(remote.file));
}

function stub(exposure: Exposure, remote: Exposed, locate: (file: string) => Remote | undefined): string {
  return exposure.stub(remote, locate, { from: `/${GENERATED}/${CALL}`, at: remote.pattern });
}

const FETCH: UserConfig = {
  environments: { ssr: { resolve: { noExternal: true } } },
  build: { rollupOptions: { preserveEntrySignatures: "strict", output: { entryFileNames: BOOT } } },
};

const CALL_MODULE = `\
import { call as send, client, define } from "@expressive/rpc";

const { pathOf } = client();
const fixed = at => !at.some(part => part[0] === ":" || part === "*");
const PATH = Symbol.for("@expressive/dev#path");
const ACTIVE = Symbol.for("@expressive/dev#router");

export { define };
const entering = (at, name) => {
  try {
    return pathOf(at, name, globalThis[PATH] || globalThis[ACTIVE]?.path);
  } catch {
    return pathOf(at, name);
  }
};

export const call = async (at, name, args) => send(fixed(at) ? "/" + at.join("/") : entering(at, name), name, args);
`;

const sourcesOf = (resolve: Sources["resolve"]): Sources => ({ resolve, read: path => readFileSync(path, "utf8") });

async function namedExports(project: Project): Promise<string[]> {
  const { exports } = await scanExports(readFileSync(project.configPath!, "utf8"), project.configPath!);
  return [...exports].filter(name => name !== "default");
}

async function buildConfig(project: Project): Promise<Settings> {
  if (!project.configPath) return {};

  const { module } = await runnerImport<{ default?: Settings }>(project.configPath, { root: project.root, configFile: false, logLevel: "silent" });
  return check(module.default ?? {}, Object.keys(module));
}

const FELL = "x-expressive-fell";
const KEPT = new Set([FELL, "content-type", "content-length", "set-cookie"]);
const VITE = ["/@vite/", "/@id/", "/@fs/", "/node_modules/", "/.expressive/", "/__inspect", "/__open-in-editor"];
const FLAGS = ["import", "url", "raw"];

function unmarked(reply: Response): Response {
  if (!reply.headers.has(FELL)) return reply;

  const copy = new Response(reply.body, reply);
  copy.headers.delete(FELL);
  return copy;
}

/** Requests that are Vite's own - its modules, a plugin's endpoints, a proxy, source files - and skip `handle`. */
function skipList(server: ViteDevServer): (request: Request) => boolean {
  const { root, base, publicDir, server: { proxy = {} } } = server.config;
  const proxied = Object.keys(proxy).map(key => {
    const pattern = key.startsWith("^") && new RegExp(key);
    return (url: string) => (pattern ? pattern.test(url) : url.startsWith(key));
  });

  const source = (path: string) => {
    try {
      const file = join(root, decodeURIComponent(path));
      return file.startsWith(root + sep) && !(publicDir && file.startsWith(publicDir + sep)) && statSync(file).isFile();
    } catch {
      return false;
    }
  };

  return request => {
    const { pathname, search, searchParams } = new URL(request.url);

    if (!pathname.startsWith(base)) return true;

    const path = pathname.slice(base.length - 1);

    return VITE.some(prefix => path.startsWith(prefix)) || proxied.some(match => match(pathname + search)) || FLAGS.some(flag => searchParams.get(flag) === "") || source(path);
  };
}

/** A copy of `req` carrying `request` - its method, path, headers and body - for Vite's stack. */
async function replica(req: IncomingMessage, request: Request): Promise<IncomingMessage> {
  const { pathname, search } = new URL(request.url);
  const body = request.body ? [Buffer.from(await request.arrayBuffer())] : [];

  return Object.assign(Readable.from(body, { objectMode: false }), {
    method: request.method,
    url: pathname + search,
    headers: { ...Object.fromEntries(request.headers), "content-length": `${body[0]?.length ?? 0}` },
    httpVersion: req.httpVersion,
    socket: req.socket,
  }) as unknown as IncomingMessage;
}

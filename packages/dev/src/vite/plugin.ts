import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServerModuleRunner, runnerImport, type Plugin, type Rollup, type UserConfig, type ViteDevServer } from "vite";
import type { ModuleRunner } from "vite/module-runner";

import type { Settings } from "../settings";
import { check } from "../server/check";
import { compose, type Pages } from "../server/compose";
import { GENERATED, SHELL, bootstrap, ensureBootstrap, importRel, prerenderEntry, PRERENDER_CALL, PRERENDER_ENTRY, resolveProject, fetchEntry, serverEntry, type Project } from "./project";
import { Exposure, type Exposed } from "./remote";
import { generateRoutes, pagePatterns, remoteEntries, remoteOf, staticPaths, type ExportScanner, type Remote, type Scan } from "./routes";
import { matchPattern } from "@expressive/router";
import { isCall, send, toRequest } from "@expressive/rpc/http";
import { verify, type Endpoint, type Seats } from "@expressive/rpc/protocol";
import { SCRIPT, guardScript, type Sources } from "@expressive/rpc/vite";
import { fileResponse } from "../server/listen";
import { install } from "../server/install";
import { hasGate, scanExports, scanGate, scanRemote } from "./scan";

const MAIN = "main.tsx";
const ROUTES = "routes.tsx";
const SERVER = "server.ts";
const PRERENDER = "prerender.tsx";
const DOM_SERVER = "@expressive/dom/server";
const CALL = "call.ts";
const REMOTE_IMPORT = /(^|\/)remote(\/|\.[cm]?[jt]s$|$)/;

/** The plugin's API - `config()` loads the app's `index.ts` settings. */
export interface Host {
  config(): Promise<Settings>;
}

const DEPS = [
  "@expressive/mvc",
  "@expressive/mvc/hot",
  "@expressive/mvc/jsx-runtime",
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

const SHARED = ["@expressive/mvc", "@expressive/dom", "@expressive/router", "@expressive/inspect", "@expressive/rpc", "@expressive/env", "@expressive/dev"];

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
  let htmlId: string;
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
  const pages = async (): Promise<Pages> => ({ patterns: project.appDir ? await pagePatterns(project.appDir, scanRoute) : ["*"], assetsDir });
  const pageStatus = async (pathname: string) => ((await pages()).patterns.some(pattern => matchPattern(pattern, pathname)) ? 200 : 404);

  const generatedPath = (id: string, importer?: string) => {
    if (id.startsWith(`/${GENERATED}/`)) return join(root, id);
    if (importer?.startsWith(generatedDir) && id.startsWith(".")) return resolve(dirname(importer), id);

    return id;
  };

  const remoteAt = (file: string) => (project.appDir ? remoteOf(project.appDir, file) : undefined);

  const api: Host = {
    async config() {
      if (!runner) throw new Error("The dev server is not running.");
      if (!project.configPath) return {};

      const module = await runner.import(project.configPath);
      return check(module.default ?? {}, Object.keys(module));
    },
  };

  const target = async () => (build ? settings!.target : (await api.config()).target);

  const gateError = async (remote: Remote) => {
    const { gate, problems } = scanGate(remote, readFileSync(remote.file, "utf8"));

    if (gate && (await target()) === "fetch") problems.push(STATELESS);

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
      htmlId = join(root, "index.html");
      assetsDir = config.build.assetsDir;
    },

    async buildStart() {
      if (build === "client") {
        const salt = settings!.remote?.opaque === false ? undefined : randomBytes(16).toString("base64url");
        builds.set(root, (exposure = new Exposure(salt)));

        for (const remote of project.appDir ? remoteEntries(project.appDir) : []) {
          const { error } = await gateError(remote);
          if (error) this.error(error);
        }
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
          return generated;
      }

      if (id === htmlId && !existsSync(htmlId)) return htmlId;
      if (id === DOM_SERVER && importer === prerenderId) return this.resolve(id, fileURLToPath(import.meta.url), { skipSelf: true });
      if (options.ssr || !importer || !REMOTE_IMPORT.test(id) || !SCRIPT.test(importer.split("?")[0])) return;

      const resolved = await this.resolve(id, importer, { ...options, skipSelf: true });
      const remote = resolved && remoteAt(resolved.id);

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

        if (scanned.gate && (await target()) === "fetch") problems.push(STATELESS);
        if (problems.length) this.error(`${relative(root, file)}: ${problems.join(" ")}`);

        const exposed = { ...remote, ...scanned };
        exposure.modules.set(file, exposed);

        return stub(exposure, exposed, remoteAt);
      }

      switch (id) {
        case callId:
          if (prerendering) return PRERENDER_CALL;

          return `export { call, define } from "@expressive/rpc";`;
        case mainId:
          return bootstrap(project.appDir ? `./${ROUTES}` : importRel(generatedDir, project.appPath!));
        case routesId:
          return (routes = await generate());
        case serverId:
          return settings?.target === "fetch" ? fetchEntry(project, generatedDir, exposure, await namedExports(project), await pages()) : serverEntry(project, generatedDir, exposure, gated(project), await pages());
        case prerenderId: {
          if (!project.appDir) return prerenderEntry(importRel(generatedDir, project.appPath!), []);

          const { sources } = await staticPaths(project.appDir, scanExports);
          return prerenderEntry(`./${ROUTES}`, sources.map(file => importRel(generatedDir, file)));
        }
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
      const host = (runner = createServerModuleRunner(server.environments.ssr));
      install();
      watchRoutes(server, project, routesId, async () => routes !== undefined && routes !== await generate());

      const endpoints = () => exposure.byPattern().map(group => endpointOf(host, root, exposure, group));
      const ctx = { waitUntil: (promise: Promise<unknown>) => void promise.catch(error => server.config.logger.error(`waitUntil: ${error}`)) };
      const shell = (url: string) => server.transformIndexHtml(url, readShell());
      const replayed = new WeakSet<object>();
      const skipped = skipList(server);

      const gates: Seats = async pattern => {
        const remote = project.appDir && remoteEntries(project.appDir).find(remote => remote.pattern.join("/") === pattern.join("/"));

        if (!remote) return;

        const { gate, error } = await gateError(remote);

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

          if (!call && skipped(request)) return next();

          const settings = await api.config();

          if (!call && !settings.handle) return next();

          let fell: { request: Request; error?: unknown } | undefined;

          const assets = {
            async fetch(forward: Request) {
              const { pathname, search } = new URL(forward.url);
              const file = server.config.publicDir && fileResponse(server.config.publicDir, pathname);
              const navigation = (forward.method === "GET" || forward.method === "HEAD") && !!forward.headers.get("accept")?.includes("text/html");

              if (file) return file;

              if (navigation)
                try {
                  return new Response(await shell(pathname + search), { status: await pageStatus(pathname), headers: { "content-type": "text/html" } });
                } catch (error) {
                  fell = { request: forward, error };
                }

              fell ??= { request: forward };

              return new Response(null, { status: 404, headers: { [FELL]: "1" } });
            },
          };

          const app = compose(settings, { sidecars: endpoints, gates, dev: true });
          const reply = await app(request, { ctx, assets });

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
          if (req.method !== "GET" || !req.headers.accept?.includes("text/html")) return next();

          try {
            const html = await shell(req.originalUrl!);
            res.statusCode = await pageStatus(new URL(req.originalUrl!, "http://x").pathname);
            res.setHeader("Content-Type", "text/html");
            res.end(html);
          } catch (error) {
            next(error);
          }
        });
      };
    },
  };
}

function watchRoutes(server: ViteDevServer, project: Project, routesId: string, stale: () => Promise<boolean>) {
  const { appDir } = project;
  if (!appDir) return;

  server.watcher.add(appDir);

  const reload = () => {
    const mod = server.moduleGraph.getModuleById(routesId);
    if (mod) server.moduleGraph.invalidateModule(mod);
    server.ws.send({ type: "full-reload" });
  };

  const moved = (file: string) => {
    if (file.startsWith(appDir)) reload();
  };

  const edited = async (file: string) => {
    if (!file.startsWith(appDir)) return;

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

const STATELESS = "The fetch target does not run folder gates - export functions only, no default.";

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

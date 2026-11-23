import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServerModuleRunner, runnerImport, type Plugin, type Rollup, type UserConfig, type ViteDevServer } from "vite";
import type { ModuleRunner } from "vite/module-runner";

import { wrap, type AppConfig, type Ctx } from "../server/config";
import { GENERATED, SHELL, bootstrap, ensureBootstrap, importRel, prerenderEntry, PRERENDER_CALL, PRERENDER_ENTRY, resolveProject, fetchEntry, serverEntry, type Project } from "./project";
import { runtime } from "../client/twin";
import { Exposure, shapeOf, type Definition, type Exposed } from "./remote";
import { generateRoutes, remoteEntries, remoteOf, staticPaths, type ExportScanner, type Remote, type Scan } from "./routes";
import { isCall, scoped, toNode } from "@expressive/rpc/http";
import { bind, dispatch, failure, verify, type Seats } from "@expressive/rpc/protocol";
import { SCRIPT, guardScript, type Sources } from "@expressive/rpc/vite";
import { fileResponse } from "../server/serve";
import { isStream, stream } from "../server/stream";
import { install } from "../server/install";
import { twins, type Endpoint, type Exports, type Pooled } from "../server/twin";
import { hasSeat, scanExports, scanRemote } from "./scan";

const MAIN = "main.tsx";
const ROUTES = "routes.tsx";
const SERVER = "server.ts";
const PRERENDER = "prerender.tsx";
const DOM_SERVER = "@expressive/dom/server";
const CALL = "call.ts";
const REMOTE_IMPORT = /(^|\/)remote(\/|\.[cm]?[jt]s$|$)/;

/** The plugin's API - `config()` loads the app's `index.ts` settings. */
export interface Host {
  config(): Promise<AppConfig>;
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
 * Serves the virtual shell, entry and route tree under `/.expressive/`, and builds sidecars and twins.
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
  let settings: AppConfig | undefined;
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
      return ((await runner.import(project.configPath)).default as AppConfig) ?? {};
    },
  };

  const target = async () => (build ? settings!.target : (await api.config()).target);

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
    },

    async buildStart() {
      if (build === "client") {
        const salt = settings!.remote?.opaque === false ? undefined : randomBytes(16).toString("base64url");
        builds.set(root, (exposure = new Exposure(salt)));
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
        const sources: Sources = {
          resolve: async (spec, importer) => (await this.resolve(spec, importer, { skipSelf: true }))?.id.split("?")[0],
          read: path => readFileSync(path, "utf8"),
        };

        const { problems, ...scanned } = await scanRemote(remote, readFileSync(file, "utf8"), sources, remoteAt);

        if (problems.length) this.error(`${relative(root, file)}: ${problems.join(" ")}`);
        if ((await target()) === "fetch") stateless(this, relative(root, file), scanned);

        const exposed = { ...remote, ...scanned };
        exposure.modules.set(file, exposed);

        return stub(exposure, exposed, remoteAt);
      }

      switch (id) {
        case callId:
          if (prerendering) return PRERENDER_CALL;

          return [
            `import { Context, Model, def } from "@expressive/mvc";`,
            `import { Route } from "@expressive/dev";`,
            `import { client } from "@expressive/rpc";`,
            `export const { call, define, twin } = (${runtime})(client, Model, def, Context, Route);`,
          ].join("\n");
        case mainId:
          return bootstrap(project.appDir ? `./${ROUTES}` : importRel(generatedDir, project.appPath!));
        case routesId:
          return (routes = await generate());
        case serverId:
          return settings?.target === "fetch" ? fetchEntry(project, generatedDir, exposure, await namedExports(project)) : serverEntry(project, generatedDir, exposure, seated(project));
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
      const ctx: Ctx = {
        waitUntil: promise => void promise.catch(error => server.config.logger.error(`waitUntil: ${error}`)),
      };
      let bound: Promise<object> | undefined;

      const bindings = () =>
        (bound ??= (async () => {
          const { bindings: provide } = await host.import(project.configPath!);
          return typeof provide == "function" ? provide() : {};
        })().catch(error => {
          bound = undefined;
          throw error;
        }));

      const shell = (url: string) => server.transformIndexHtml(url, readShell());

      server.middlewares.use(toNode(async request => {
        if (isStream(request)) return stream(request);

        const config = await api.config();
        const call = isCall(request);

        if (!call && !config.fetch) return;

        const env = config.target === "fetch" ? await bindings() : {};

        const scope = { request, env, ctx };

        bind(request, env);

        if (call) return wrap(config, scope, () => dispatch(request, endpoints, true, seatsOf(host, project), twins)).catch(error => failure(error, endpoints(), true));

        const { pathname, search } = new URL(request.url);
        const { publicDir } = server.config;
        const next = async () =>
          (publicDir && fileResponse(publicDir, pathname)) || new Response(await shell(pathname + search), { headers: { "content-type": "text/html" } });

        return wrap(config, scope, async () => scoped(config).fetch!(request, env, ctx, next));
      }));

      return () => {
        server.middlewares.use(async (req, res, next) => {
          if (req.method !== "GET" || !req.headers.accept?.includes("text/html")) return next();

          try {
            const html = await shell(req.originalUrl!);
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
    async exports() {
      const plain = await exposure.exports(group, file => host.import(file), (file, exports) => verify(relative(root, file), exports));
      const pool: Record<string, Pooled> = {};
      let seat: Exports["seat"];

      for (const remote of group) {
        const mod = await host.import(remote.file);

        if (remote.seat) seat = { ...shapeOf(remote.seat), methods: exposure.methodIds(remote, remote.seat, false) };

        for (const twin of remote.pooled)
          pool[exposure.classId(remote, twin.name)] = { Type: mod[twin.name], ...shapeOf(twin), methods: exposure.methodIds(remote, twin, true) };
      }

      return { ...plain, seat, pool };
    },
  };
}

function seated(project: Project): Remote[] {
  if (!project.appDir) return [];

  return remoteEntries(project.appDir).filter(remote => hasSeat(remote.file));
}

function seatsOf(host: ModuleRunner, project: Project): Seats {
  return async pattern => {
    const remote = seated(project).find(remote => remote.pattern.join("/") === pattern.join("/"));
    return remote && (await host.import(remote.file)).default;
  };
}

function stub(exposure: Exposure, remote: Exposed, locate: (file: string) => Remote | undefined): string {
  const json = JSON.stringify;
  const twinOf = (definition: Definition, pool?: string) => {
    const args = [json(definition.methods), json(definition.fields), json(definition.name)];

    if (pool || definition.children) args.push(pool ? json(pool) : "undefined");
    if (definition.children) args.push(json(definition.children));

    return `twin(at, ${args.join(", ")})`;
  };

  return exposure.stub(remote, locate, {
    from: `/${GENERATED}/${CALL}`,
    at: remote.pattern,
    imports: ["twin"],
    lines: [
      ...remote.pooled.map(twin => `export const ${twin.name} = ${twinOf(exposure.definition(remote, twin, true), exposure.classId(remote, twin.name))};`),
      ...(remote.seat ? [`export default ${twinOf(exposure.definition(remote, remote.seat, false))};`] : []),
    ],
  });
}

const FETCH: UserConfig = {
  environments: { ssr: { resolve: { noExternal: true } } },
  build: { rollupOptions: { preserveEntrySignatures: "strict", output: { entryFileNames: BOOT } } },
};

function stateless(context: { error(message: string): never }, file: string, { seat, pooled }: { seat?: unknown; pooled: { name: string }[] }) {
  const why = "- the fetch target keeps no state between requests, so a remote there exports functions only.";

  if (seat) context.error(`${file} default-exports a seat ${why}`);
  if (pooled.length) context.error(`${file} exports Model ${pooled.map(twin => twin.name).join(", ")} ${why}`);
}

async function namedExports(project: Project): Promise<string[]> {
  const { exports } = await scanExports(readFileSync(project.configPath!, "utf8"), project.configPath!);
  return [...exports].filter(name => name !== "default" && name !== "bindings");
}

async function buildConfig(project: Project): Promise<AppConfig> {
  if (!project.configPath) return {};

  const { module } = await runnerImport<{ default?: AppConfig }>(project.configPath, { root: project.root, configFile: false, logLevel: "silent" });
  return module.default ?? {};
}

import { existsSync } from "node:fs";
import { join, relative } from "node:path";

import type { Pages } from "../server/compose";
import type { ApiFile } from "./api";
import type { Exposed, Exposure } from "./remote";
import type { Remote } from "./routes";

export interface Project {
  root: string;
  appPath?: string;
  appDir?: string;
  configPath?: string;
  htmlPath?: string;
}

export const GENERATED = ".expressive";

export const SHELL = `\
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/${GENERATED}/main.tsx"></script>
  </body>
</html>
`;

export function resolveProject(root: string): Project {
  const indexTs = join(root, "index.ts");
  const indexHtml = join(root, "index.html");

  return {
    root,
    ...appEntry(root),
    configPath: existsSync(indexTs) ? indexTs : undefined,
    htmlPath: existsSync(indexHtml) ? indexHtml : undefined,
  };
}

function appEntry(root: string): Pick<Project, "appDir" | "appPath"> {
  const appDir = join(root, "app");
  const files = [join(root, "app.tsx"), join(root, "src", "app.tsx")].filter(file => existsSync(file));

  if (existsSync(appDir)) {
    if (files.length) throw new Error("Found both an app/ directory and app.tsx - pick routed mode or single-file.");
    return { appDir };
  }

  if (files.length > 1) throw new Error("Found both ./app.tsx and ./src/app.tsx - pick one.");
  if (!files.length) throw new Error("Missing app.tsx at project root or under src/ (or an app/ directory).");

  return { appPath: files[0] };
}

export const PRERENDERED = "data-prerender";

export const UNMATCHED = "@expressive/dev#unmatched";

export const PRERENDER_ENTRY = `/${GENERATED}/prerender.tsx`;

const SETTLE = 30_000;

export function bootstrap(appImport: string): string {
  return `\
import { hydrate, render } from "@expressive/dev";
import { jsx } from "@expressive/dev/jsx-runtime";
import App from ${JSON.stringify(appImport)};

const el = document.getElementById("root");
if (!el) throw new Error("Missing #root element");

const adopt = el.getAttribute("${PRERENDERED}") === location.pathname.replace(/(.)\\/$/, "$1");

for (const node of document.querySelectorAll("[${PRERENDERED}]"))
  if (adopt || node === el) node.removeAttribute("${PRERENDERED}");
  else node.remove();

(adopt ? hydrate : render)(jsx(App, {}), el);
`;
}

export function prerenderEntry(appImport: string, sources: string[]): string {
  const imports = sources.map((source, index) => `import { paths as p${index} } from ${JSON.stringify(source)};\n`).join("");
  const lists = sources.map((_, index) => `p${index}`).join(", ");

  return `\
import { renderToString } from "@expressive/dom/server";
import { Model } from "@expressive/mvc";
import { NotFound, Redirect, Router } from "@expressive/dev";
import { jsx } from "@expressive/dev/jsx-runtime";
import { scope } from "./call.ts";
import App from ${JSON.stringify(appImport)};
${imports}
export async function paths() {
  const found = [];

  for (const list of [${lists}]) {
    const mark = { called: false };

    try {
      found.push(...[await scope.run(mark, list)].flat());
    } catch (error) {
      if (!mark.called) throw error;
    }
  }

  return found;
}

const pages = new WeakMap();

Model.on({
  setup(self) {
    pages.set(self, scope.getStore());
  },
  catch(error, kind) {
    if (kind == "dead" || kind == "unused") return error;

    const mark = pages.get(this);

    if (mark && !mark.done) mark.failed ??= [error];
    else console.warn((mark ? mark.path : "A Model") + " failed after its page rendered at build: " + (error?.message ?? error));
  },
});

export default async function page(path) {
  let router;
  const stop = Router.on({ setup(self) { router = self; } });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error("did not settle within ${SETTLE / 1000}s.")), ${SETTLE});
  const mark = { called: false, abort, path };

  try {
    const output = await scope.run(mark, () => renderToString(jsx(App, { path }), { signal: abort.signal }));
    if (mark.called) return null;
    if (mark.failed) throw mark.failed[0];
    return { ...output, path: router ? router.path : path };
  } catch (error) {
    if (mark.called) return null;
    if (error?.[Symbol.for("${UNMATCHED}")]) return "unmatched";
    if (error instanceof Redirect || error instanceof NotFound) return "decided";
    throw error;
  } finally {
    mark.done = true;
    clearTimeout(timer);
    stop();
  }
}
`;
}

export const PRERENDER_CALL = `\
import { define } from "@expressive/rpc";

export { define };

const { AsyncLocalStorage } = process.getBuiltinModule("node:async_hooks");

export const scope = new AsyncLocalStorage();

function halt() {
  const error = new Error("Remote calls do not run at build.");
  const mark = scope.getStore();

  if (mark) {
    mark.called = true;
    mark.abort?.abort(error);
  }

  return error;
}

export function call() {
  if (scope.getStore()?.abort) return halt(), new Promise(() => {});

  const refused = Promise.reject(halt());

  refused.catch(() => {});

  return refused;
}
`;

export function ensureBootstrap(html: string): string {
  let out = html;

  if (!/id=["']root["']/.test(out)) out = injectBeforeBody(out, `<div id="root"></div>`);
  if (!out.includes(`${GENERATED}/main.tsx`))
    out = injectBeforeBody(out, `<script type="module" src="/${GENERATED}/main.tsx"></script>`);

  return out;
}

function injectBeforeBody(html: string, tag: string): string {
  return html.includes("</body>")
    ? html.replace("</body>", `  ${tag}\n  </body>`)
    : html + "\n" + tag + "\n";
}

/** The `api/` folder's modules for an entry, `routes` undefined without one. */
export interface ApiEntry {
  prefix: string;
  routes?: ApiFile[];
}

const apiImports = (from: string, { routes = [] }: ApiEntry) => routes.map(({ file }, i) => `import * as a${i} from ${JSON.stringify(importRel(from, file))};`);

const apiRef = ({ name, path, index, calls, classes }: ApiFile) => {
  const ids = Object.keys({ ...calls, ...classes }).length ? `, calls: ${JSON.stringify(calls)}, classes: ${JSON.stringify(classes)}` : "";

  return `{ name: ${JSON.stringify(name)}, path: ${JSON.stringify(path)}, index: ${index}${ids} }`;
};

export function serverEntry(project: Project, from: string, exposure: Exposure, gates: Remote[], api: ApiEntry, pages: Pages): string {
  const configSpec = project.configPath && JSON.stringify(importRel(from, project.configPath));
  const files = [...new Set([...exposure.modules.keys(), ...gates.map(gate => gate.file)])];
  const modules = files.map(file => JSON.stringify(importRel(from, file)));
  const alias = (file: string) => `s${files.indexOf(file)}`;

  const entries = exposure.byPattern().map(group =>
    `    { pattern: ${JSON.stringify(group[0].pattern)}, async exports() { return { ${exposure.table(group, alias)} }; } },`);

  return [
    `import { fileURLToPath } from "node:url";`,
    `import { listen } from "@expressive/dev/server";`,
    configSpec ? `import settings from ${configSpec};` : `const settings = {};`,
    ...modules.map((m, i) => `import * as s${i} from ${m};`),
    ...apiImports(from, api),
    "",
    "listen({",
    "  settings,",
    `  client: fileURLToPath(new URL("../client/", import.meta.url)),`,
    "  sidecars: [", ...entries, "  ],",
    "  gates: [", ...gates.map(gate => `    { pattern: ${JSON.stringify(gate.pattern)}, gate: ${alias(gate.file)}.default },`), "  ],",
    ...(api.routes ? [`  api: { prefix: ${JSON.stringify(api.prefix)}, routes: [`, ...api.routes.map((route, i) => `    { ...${apiRef(route)}, module: a${i} },`), "  ] },"] : []),
    `  pages: ${JSON.stringify(pages)},`,
    "});",
    "",
  ].join("\n");
}

export function fetchEntry(project: Project, from: string, exposure: Exposure, named: string[], api: ApiEntry, pages: Pages, gates: Remote[]): string {
  const configSpec = JSON.stringify(importRel(from, project.configPath!));
  const files = [...new Set([...exposure.modules.keys(), ...gates.map(gate => gate.file)])];
  const ref = (remote: Remote, name: string) => [files.indexOf(remote.file), name];
  const ids = (group: Exposed[], names: (remote: Exposed) => string[], id: (remote: Exposed, name: string) => string) =>
    Object.fromEntries(group.flatMap(remote => names(remote).map(name => [id(remote, name), ref(remote, name)])));
  const manifest = exposure.byPattern().map(group => ({
    pattern: group[0].pattern,
    calls: ids(group, remote => remote.calls, (remote, name) => exposure.callId(remote, name)),
    classes: ids(group, remote => remote.errors.map(error => error.name), (remote, name) => exposure.classId(remote, name)),
  }));
  const gated = gates.map(gate => ({ pattern: gate.pattern, gate: ref(gate, "default") }));

  return [
    `import { compose } from "@expressive/dev/fetch";`,
    `import settings from ${configSpec};`,
    ...files.map((file, i) => `import * as s${i} from ${JSON.stringify(importRel(from, file))};`),
    ...apiImports(from, api),
    `export { ${named.join(", ")} } from ${configSpec};`,
    "",
    `export default compose(settings, [${files.map((_, i) => `s${i}`).join(", ")}], ${JSON.stringify(manifest)}, [${(api.routes ?? []).map((_, i) => `a${i}`).join(", ")}], ${api.routes ? `{ prefix: ${JSON.stringify(api.prefix)}, routes: [${api.routes.map(apiRef).join(", ")}] }` : "null"}, ${JSON.stringify(pages)}, ${JSON.stringify(gated)});`,
    "",
  ].join("\n");
}

export function importRel(from: string, file: string): string {
  const rel = relative(from, file).replaceAll("\\", "/");
  return rel.startsWith(".") ? rel : "./" + rel;
}

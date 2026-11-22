import { existsSync } from "node:fs";
import { join, relative } from "node:path";

import { shapeOf, type Exposed, type Exposure } from "./remote";
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
import { Router } from "@expressive/dev";
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

export default async function page(path) {
  let router;
  const stop = Router.on({ setup(self) { router = self; } });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error("did not settle within ${SETTLE / 1000}s.")), ${SETTLE});
  const mark = { called: false, abort };

  try {
    const output = await scope.run(mark, () => renderToString(jsx(App, { path }), { signal: abort.signal }));
    return mark.called ? null : { ...output, path: router ? router.path : path };
  } catch (error) {
    if (mark.called) return null;
    throw error;
  } finally {
    clearTimeout(timer);
    stop();
  }
}
`;
}

export const PRERENDER_CALL = `\
import { Model, def } from "@expressive/mvc";
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

export function twin(_at, methods, fields, name) {
  const Twin = {
    [name]: class extends Model {
      constructor(...args) {
        super(...args);

        for (const field of fields) this[field] = def(() => ({ get() { throw halt(); } }));
      }

      get(...args) {
        if (!args.length || typeof args[0] == "string") throw halt();

        return super.get(...args);
      }
    },
  }[name];

  for (const method of Object.keys(methods)) Object.defineProperty(Twin.prototype, method, { configurable: true, writable: true, value: call });

  return Twin;
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

export function serverEntry(project: Project, from: string, exposure: Exposure, seats: Remote[]): string {
  const configSpec = project.configPath && JSON.stringify(importRel(from, project.configPath));
  const files = [...new Set([...exposure.modules.keys(), ...seats.map(seat => seat.file)])];
  const modules = files.map(file => JSON.stringify(importRel(from, file)));
  const alias = (file: string) => `s${files.indexOf(file)}`;

  const entries = exposure.byPattern().map(group => {
    const pool = group.flatMap(remote => remote.pooled.map(twin =>
      `${JSON.stringify(exposure.classId(remote, twin.name))}: { Type: ${alias(remote.file)}.${twin.name}, ${props({ ...shapeOf(twin), methods: exposure.methodIds(remote, twin, true) })} }`)).join(", ");
    const seated = group.find(remote => remote.seat);
    const seat = seated && JSON.stringify({ ...shapeOf(seated.seat!), methods: exposure.methodIds(seated, seated.seat!, false) });

    return `    { pattern: ${JSON.stringify(group[0].pattern)}, async exports() { return { ${exposure.table(group, alias)}, pool: { ${pool} }${seat ? `, seat: ${seat}` : ""} }; } },`;
  });

  return [
    `import { fileURLToPath } from "node:url";`,
    `import { serve } from "@expressive/dev/server";`,
    configSpec ? `import config from ${configSpec};` : `const config = {};`,
    ...modules.map((m, i) => `import * as s${i} from ${m};`),
    "",
    "serve({",
    "  config,",
    `  client: fileURLToPath(new URL("../client/", import.meta.url)),`,
    "  sidecars: [", ...entries, "  ],",
    "  seats: [", ...seats.map(seat => `    { pattern: ${JSON.stringify(seat.pattern)}, Type: ${alias(seat.file)}.default },`), "  ],",
    "});",
    "",
  ].join("\n");
}

export function fetchEntry(project: Project, from: string, exposure: Exposure, named: string[]): string {
  const configSpec = JSON.stringify(importRel(from, project.configPath!));
  const files = [...exposure.modules.keys()];
  const ref = (remote: Exposed, name: string) => [files.indexOf(remote.file), name];
  const ids = (group: Exposed[], names: (remote: Exposed) => string[], id: (remote: Exposed, name: string) => string) =>
    Object.fromEntries(group.flatMap(remote => names(remote).map(name => [id(remote, name), ref(remote, name)])));
  const manifest = exposure.byPattern().map(group => ({
    pattern: group[0].pattern,
    calls: ids(group, remote => remote.calls, (remote, name) => exposure.callId(remote, name)),
    classes: ids(group, remote => remote.errors.map(error => error.name), (remote, name) => exposure.classId(remote, name)),
  }));

  return [
    `import { fetchHandler } from "@expressive/dev/fetch";`,
    `import config from ${configSpec};`,
    ...files.map((file, i) => `import * as s${i} from ${JSON.stringify(importRel(from, file))};`),
    `export { ${named.join(", ")} } from ${configSpec};`,
    "",
    `export default fetchHandler(config, [${files.map((_, i) => `s${i}`).join(", ")}], ${JSON.stringify(manifest)});`,
    "",
  ].join("\n");
}

function props(object: object): string {
  return Object.entries(object).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(", ");
}

export function importRel(from: string, file: string): string {
  const rel = relative(from, file).replaceAll("\\", "/");
  return rel.startsWith(".") ? rel : "./" + rel;
}

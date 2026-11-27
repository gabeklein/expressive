import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";

import { importRel, UNMATCHED } from "./project";

const ROUTE_EXT = new Set([".tsx", ".jsx", ".ts", ".js"]);
const REMOTE = /^remote\.[cm]?[jt]s$/;
export const CALL = "call.ts";

const ROLES = [
  "Page",
  "Layout",
  "Loading",
  "Catch",
  "default",
] as const;

type Role = (typeof ROLES)[number];

export interface Scan {
  exports: Iterable<string>;
  classDefault?: boolean;
  modelDefault?: boolean;
  label?: string;
  routeParameter?: boolean;
  dropsChildren?: boolean;
}

export type ExportScanner = (source: string, path: string) => Scan | Promise<Scan>;

interface RouteNode {
  segment: string;
  name: string;
  file?: string;
  exports: Set<string>;
  classDefault: boolean | undefined;
  modelDefault: boolean;
  dropsChildren?: boolean;
  label?: string;
  children: RouteNode[];
  isLeaf: boolean;
  alias: Partial<Record<Role, string>>;
  hook?: string;
}

export async function generateRoutes(appDir: string, outDir: string, scan: ExportScanner): Promise<string> {
  const root = await scanDir(appDir, "", "", scan);

  const warn = (node: RouteNode) => {
    if (leafDefault(node) && node.modelDefault)
      console.warn(`${node.file}: a Model default without Page renders nothing.`);
    if (node.dropsChildren && (node.exports.has("Page") || node.exports.has("Layout") || node.children.some(renders)))
      console.warn(`${node.file}: the default never places its children - its Layout, Page and the routes below never show.`);
    node.children.forEach(warn);
  };
  warn(root);

  assignAliases(root, new Set(["NotFound", "Route", "Router", "DefaultCatch", "missing", "hook", "wrap", "watching", "Through", "Component", "Model"]));

  const { imports, loaders } = collectImports(root, outDir, dirname(appDir));
  const wrappers = collectWrappers(root, dirname(appDir));
  const tree = emitNode(root, true, 2, "null", outDir).join("\n");
  const pageImports = `{ ${[
    "NotFound",
    "Route",
    !root.exports.has("Router") && "Router",
  ].filter(Boolean).join(", ")} }`;
  const scoped = some(root, node => !!scopeOf(node));
  const either = some(root, node => !!hookOf(node));

  return [
    `import ${pageImports} from "@expressive/dev";`,
    ...((scoped || either) ? ['import { Model } from "@expressive/mvc";'] : []),
    "",
    ...imports,
    ...(scoped ? ["", `const wrapped = new WeakMap();
const wrap = (Type, children, file) => {
  if (Model.is(Type)) return children;
  if (/^class\\b/.test(String(Type))) throw new Error(file + ": the default export " + Type.name + " is a class but not a Model or Component.");
  let View = wrapped.get(Type);
  if (!View) {
    View = new Proxy(Type, { apply(target, receiver, args) {
      const check = result => { if (typeof result === "string") throw new Error(file + ": a function default is a component and must not return a string. Wrap text in a fragment."); return result; };
      const result = Reflect.apply(target, receiver, args);
      return result instanceof Promise ? result.then(check) : check(result);
    } });
    wrapped.set(Type, View);
  }
  return <View>{children}</View>;
};`] : []),
    ...(either ? [`const hook = (value, file) => { if (Model.is(value)) return value; if (/^class\\b/.test(String(value))) throw new Error(file + ": the default export " + value.name + " is a class but not a Model or Component."); };`] : []),
    ...(either || some(root, node => node.classDefault === true) ? ["const watching = (enter, source, leaf) => Object.assign(enter, { source, leaf, current: enter });"] : []),
    `const missing = () => { throw Object.assign(new NotFound(), { [Symbol.for("${UNMATCHED}")]: true }); };`,
    ...(!root.exports.has("Catch") ? ['const DefaultCatch = ({ error, retry }) => error instanceof NotFound ? <main><h1>404 - Not found</h1><p>No route matched.</p><a href="/">Home</a></main> : (console.error(error), <main><h1>Something went wrong</h1>{import.meta.env.DEV && <p>{error.message}</p>}<button onClick={retry}>Try again</button><a href="/">Home</a></main>);'] : []),
    ...(loaders.length ? ["", ...loaders] : []),
    ...(wrappers.length ? ["", ...wrappers] : []),
    ...(tree.includes("as={Through}") ? ["", "const Through = props => props.children;"] : []),
    'if (import.meta.hot) import.meta.hot.on("vite:afterUpdate", payload => window.dispatchEvent(new CustomEvent("expressive:route-update", { detail: payload.updates.map(update => update.path) })));',
    "",
    "const App = (props) => (\n  <Router {...props}>", tree, "  </Router>\n);\n",
    "export default App;\n",
  ].join("\n");
}

/** Every page route's pattern, as the router matches it - `/blog/:slug`, `/docs/*`. */
export async function pagePatterns(appDir: string, scan: ExportScanner): Promise<string[]> {
  const patterns: string[] = [];

  (function walk(node: RouteNode, path: string) {
    if (hasPage(node)) patterns.push(path || "/");

    for (const child of node.children) walk(child, `${path}/${child.segment}`);
  })(await scanDir(appDir, "", "", scan), "");

  return patterns;
}

/**
 * Pages a build tries to render ahead. Fixed paths are listed;
 * below a `:param` or `*`, modules exporting `paths()` are returned to list their own.
 */
export async function staticPaths(appDir: string, scan: ExportScanner): Promise<{ paths: string[]; sources: string[] }> {
  const paths: string[] = [];
  const sources: string[] = [];

  (function walk(node: RouteNode, path: string, dynamic: boolean) {
    if (dynamic && node.exports.has("paths")) sources.push(node.file!);
    if (!dynamic && hasPage(node)) paths.push(path || "/");

    for (const child of node.children)
      walk(child, `${path}/${child.segment}`, dynamic || !!precedence(child.segment));
  })(await scanDir(appDir, "", "", scan), "", false);

  return { paths, sources };
}

const some = (node: RouteNode, test: (node: RouteNode) => boolean): boolean => test(node) || node.children.some(child => some(child, test));

function newNode(fields: Partial<RouteNode>): RouteNode {
  return { segment: "", name: "", exports: new Set(), classDefault: false, modelDefault: false, children: [], isLeaf: false, alias: {}, ...fields };
}

async function scanDir(dir: string, segment: string, name: string, scan: ExportScanner, appDir = dir): Promise<RouteNode> {
  const node = newNode({ segment, name });
  const entries = readdirSync(dir);
  const remote = entries.find(entry => REMOTE.test(entry) || (entry === "remote" && statSync(join(dir, entry)).isDirectory()));

  if (remote) throw new Error(moved(appDir, join(dir, remote)));

  for (const entry of entries) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      const tag = classify(entry, true)!;
      node.children.push(await scanDir(full, tag.segment, name + tag.label, scan, appDir));
      continue;
    }

    const ext = extname(entry);
    if (!ROUTE_EXT.has(ext)) continue;

    const tag = classify(basename(entry, ext), false);
    if (!tag) continue;

    const scanned = await scan(readFileSync(full, "utf8"), full);
    const exports = new Set(scanned.exports);
    const { classDefault, modelDefault, label, routeParameter, dropsChildren } = scanned;

    if (exports.has("NotFound"))
      throw new Error(`${full}: the NotFound route export was removed. Import { NotFound } from "@expressive/dev" and export Catch = ({ error }) => error instanceof NotFound ? ... : ... .`);
    if (routeParameter)
      throw new Error(`${full}: default takes "route" - entry hooks no longer redirect by return value. In a page: import { Redirect } from "@expressive/dev"; throw new Redirect("/path").`);

    if (exports.has("label") && typeof label != "string")
      throw new Error(`${full} exports a label that is not a string literal.`);

    if (tag.kind === "index") {
      node.file = full;
      node.exports = exports;
      node.classDefault = classDefault;
      node.modelDefault = !!modelDefault;
      node.dropsChildren = dropsChildren;
      node.label = label;
      continue;
    }

    node.children.push(newNode({
      segment: tag.segment,
      name: name + tag.label,
      file: full,
      exports,
      classDefault,
      modelDefault: !!modelDefault,
      label,
      isLeaf: true,
    }));
  }

  node.children.sort((a, b) => precedence(a.segment) - precedence(b.segment));

  return node;
}

function moved(appDir: string, file: string): string {
  const project = dirname(appDir);
  const folders = relative(appDir, dirname(file)).split(sep).filter(part => part && !/^\[.*\]$/.test(part));
  const shown = relative(project, file).split(sep).join("/") + (statSync(file).isDirectory() ? "/" : "");

  return `${shown}: server calls live in /api now - move it to ${["api", ...folders, "(name).ts"].join("/")}`;
}

function precedence(segment: string) {
  return segment === "*" ? 2 : segment.startsWith(":") ? 1 : 0;
}

interface Tag {
  kind: "index" | "static" | "param" | "splat";
  segment: string;
  label: string;
}

export function classify(raw: string, bareIsRoute: boolean): Tag | null {
  if (raw === "index") return { kind: "index", segment: "", label: "" };

  const paren = /^\((.+)\)$/.exec(raw);
  if (paren)
    return { kind: "static", segment: paren[1], label: pascal(paren[1]) };

  if (raw === "[...]")
    return { kind: "splat", segment: "*", label: "Catchall" };

  const square = /^\[(.+)\]$/.exec(raw);
  if (square)
    return {
      kind: "param",
      segment: ":" + square[1],
      label: pascal(square[1]),
    };

  return bareIsRoute ? { kind: "static", segment: raw, label: pascal(raw) } : null;
}

function assignAliases(node: RouteNode, used: Set<string>): void {
  const base = node.name || "Root";

  for (const role of ROLES) {
    if (!node.exports.has(role)) continue;

    const suffix = role !== "default" ? role : "Scope";

    node.alias[role] = unique(role === "Page" ? base : base + suffix, used);
  }

  if (node.alias.default && node.classDefault === undefined) node.hook = unique(base + "EnterHook", used);

  for (const child of node.children) assignAliases(child, used);
}

function unique(alias: string, used: Set<string>): string {
  while (used.has(alias)) alias += "_";
  used.add(alias);

  return alias;
}

function collectImports(root: RouteNode, outDir: string, project: string) {
  const imports: string[] = [];
  const loaders: string[] = [];

  (function walk(node: RouteNode) {
    const roles = ROLES.filter(role => node.alias[role]);
    const router = node === root && node.exports.has("Router");

    if (node.file && (roles.length || router)) {
      const spec = JSON.stringify(importRel(outDir, node.file));
      if (lazy(node)) loaders.push(...roles.map(role => loaderFor(node, role, spec, sourceOf(node, project))));
      else imports.push(importFor(node, roles, spec, router));

      if (node.hook) {
        const file = JSON.stringify(sourceOf(node, project));
        loaders.push(`const ${node.hook} = watching(${lazy(node) ? `() => import(${spec}).then(m => hook(m.default, ${file}))` : `() => hook(${node.alias.default}, ${file})`}, ${file}, ${leafDefault(node) && !node.modelDefault});`);
      }
    }

    node.children.forEach(walk);
  })(root);

  return { imports, loaders };
}

const isRoot = (node: RouteNode): boolean => !node.name;
const sourceOf = (node: RouteNode, project: string): string => relative(project, node.file!).split(sep).join("/");
const lazy = (node: RouteNode): boolean => !isRoot(node) && !node.alias.Loading && !node.alias.Catch;

function loaderFor(node: RouteNode, role: Role, spec: string, file: string): string {
  const load = role === "default" && node.classDefault !== true
    ? `() => import(${spec}).then(m => props => wrap(m.default, props.children, ${JSON.stringify(file)}))`
    : `() => import(${spec}).then(m => m.${role})`;
  return `const ${node.alias[role]} = ${load};`;
}

function importFor(node: RouteNode, roles: Role[], spec: string, router: boolean): string {
  const named = roles.filter(role => role !== "default").map(role => `${role} as ${node.alias[role]}`);
  if (router) named.push("Router");
  const namedClause = named.length ? `{ ${named.join(", ")} }` : undefined;
  const clause = [node.alias.default, namedClause].filter(Boolean).join(", ");

  return `import ${clause} from ${spec};`;
}

const leafDefault = (node: RouteNode): boolean => !!node.file && !node.children.length && !node.exports.has("Page") && node.exports.has("default");

const hasPage = (node: RouteNode): boolean => node.exports.has("Page") || (!!node.file && !node.children.length && node.exports.has("default"));

const renders = (node: RouteNode): boolean => hasPage(node) || node.children.some(renders);

const scopeOf = (node: RouteNode): string | undefined => node.alias.default;

const hookOf = (node: RouteNode): string | undefined => node.hook;

function collectWrappers(root: RouteNode, project: string): string[] {
  const wrappers: string[] = [];

  (function walk(node: RouteNode) {
    node.children.forEach(walk);
    if (!node.alias.default || node.classDefault === true) return;
    const file = JSON.stringify(sourceOf(node, project));
    const alias = node.alias.default + "d";
    const layout = node.alias.Layout ? `<${node.alias.Layout}>{props.children}</${node.alias.Layout}>` : "props.children";
    wrappers.push(`const ${alias} = props => ${lazy(node) ? `<${node.alias.default}>{${layout}}</${node.alias.default}>` : `wrap(${node.alias.default}, ${layout}, ${file})`};`);
  })(root);

  return wrappers;
}

const caught = (node: RouteNode) => node.children.some(child => child.segment === "*");

function emitNode(node: RouteNode, isRoot: boolean, depth: number, slot: string, outDir: string, contend = false): string[] {
  const pad = "  ".repeat(depth);
  const { Page, Layout, Loading, Catch } = node.alias;
  const label = node.label === undefined ? undefined : JSON.stringify(node.label);
  const hook = hookOf(node);
  const enter = node.classDefault === true ? `watching(() => ${lazy(node) ? `${node.alias.default}()` : node.alias.default}, ${JSON.stringify(sourceOf(node, dirname(outDir)))}, ${leafDefault(node) && !node.modelDefault})` : hook;
  const scope = scopeOf(node);

  const own = Loading ? `<${Loading} />` : undefined;
  const isScope = isRoot || node.children.length > 0 || !!Layout || (!node.isLeaf && !!Catch) || !!scope;

  if (!isScope)
    return Page ? route(pad, { to: node.segment, label, as: Page, enter, fallback: own ?? slot, Catch }) : [];

  const inner: string[] = [];
  const childSlot = own ?? (Layout ? "null" : slot);

  if (Page) inner.push(...route(pad + "  ", { as: Page, fallback: childSlot }));

  const rivals = node.children.some(child => precedence(child.segment) > 0);

  for (const child of node.children)
    inner.push(...emitNode(child, false, depth + 1, childSlot, outDir, rivals));

  if (!inner.length && !Catch && !isRoot && !scope) return [];

  const as = scope && node.classDefault !== true ? scope + "d" : Layout ?? (contend ? "Through" : undefined);
  if (!node.isLeaf && (Catch || isRoot) && !caught(node)) inner.push(`${pad}  <Route none as={missing} fallback={null} />`);

  return route(
    pad,
    { to: isRoot ? undefined : node.segment, label, as, enter, fallback: slot, Catch: Catch ?? (isRoot ? "DefaultCatch" : undefined) },
    inner,
  );
}

interface RouteProps {
  to?: string;
  label?: string;
  as?: string;
  enter?: string;
  fallback?: string;
  Catch?: string;
}

function route(pad: string, attrs: RouteProps, children?: string[]): string[] {
  const props = Object.entries(attrs)
    .filter(([, v]) => v)
    .map(([k, v]) => (k === "to" ? ` ${k}="${v}"` : ` ${k}={${v}}`))
    .join("");

  const head = `${pad}<Route${props}`;

  return children
    ? [`${head}>`, ...children, `${pad}</Route>`]
    : [`${head} />`];
}

function pascal(s: string): string {
  return s
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1))
    .join("");
}

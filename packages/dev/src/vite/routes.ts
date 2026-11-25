import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";

import { importRel } from "./project";
import { hasGate } from "./scan";

const ROUTE_EXT = new Set([".tsx", ".jsx", ".ts", ".js"]);
const REMOTE = "remote";
const REMOTE_FILE = /^remote\.[cm]?[jt]s$/;
const REMOTE_MODULE = /\.[cm]?[jt]s$/;
const REMOTE_INDEX = /^index\.[cm]?[jt]s$/;
export const CALL = "call.ts";

const ROLES = [
  "Page",
  "Layout",
  "Loading",
  "Catch",
  "NotFound",
  "default",
] as const;

type Role = (typeof ROLES)[number];

export interface Scan {
  exports: Iterable<string>;
  classDefault?: boolean;
  label?: string;
}

export type ExportScanner = (source: string, path: string) => Scan | Promise<Scan>;

interface RouteNode {
  segment: string;
  name: string;
  file?: string;
  exports: Set<string>;
  classDefault: boolean;
  label?: string;
  children: RouteNode[];
  isLeaf: boolean;
  gated: boolean;
  alias: Partial<Record<Role, string>>;
}

export async function generateRoutes(appDir: string, outDir: string, scan: ExportScanner): Promise<string> {
  const root = await scanDir(appDir, "", "", scan);

  assignAliases(root, new Set());

  const { imports, loaders } = collectImports(root, outDir);
  const wrappers = collectWrappers(root);
  const tree = emitNode(root, true, 2, "null", outDir).join("\n");
  const gates = gatedPatterns(root);
  const pageImports = `{ ${[
    gates.length && "gateCheck",
    !root.exports.has("NotFound") && "NotFound",
    "Route",
    !root.exports.has("Router") && "Router",
  ].filter(Boolean).join(", ")} }`;
  const provides = [...loaders, ...wrappers].some(line => line.includes("<Component for="));

  return [
    `import ${pageImports} from "@expressive/dev";`,
    ...(provides ? ['import { Component } from "@expressive/mvc";'] : []),
    ...(gates.length ? [`import { call } from "./${CALL}";`] : []),
    "",
    ...imports,
    ...(gates.length ? ["", `const checked = gateCheck(call, ${JSON.stringify(gates)}, import.meta.hot);`] : []),
    ...(loaders.length ? ["", ...loaders] : []),
    ...(wrappers.length ? ["", ...wrappers] : []),
    "",
    "const App = (props) => (\n  <Router {...props}>", tree, "  </Router>\n);\n",
    "export default App;\n",
  ].join("\n");
}

function gatedPatterns(root: RouteNode): string[] {
  const patterns: string[] = [];

  (function walk(node: RouteNode, path: string) {
    if (node.gated) patterns.push(path || "/");

    for (const child of node.children) walk(child, `${path}/${child.segment}`);
  })(root, "");

  return patterns;
}

/** Every page route's pattern, as the router matches it - `/blog/:slug`, `/docs/*`. */
export async function pagePatterns(appDir: string, scan: ExportScanner): Promise<string[]> {
  const patterns: string[] = [];

  (function walk(node: RouteNode, path: string) {
    if (node.exports.has("Page")) patterns.push(path || "/");

    for (const child of node.children) walk(child, `${path}/${child.segment}`);
  })(await scanDir(appDir, "", "", scan), "");

  return patterns;
}

/**
 * Pages a build tries to render ahead. Fixed paths are listed;
 * below a `:param` or `*`, modules exporting `paths()` are returned to list their own.
 * Gated folders are skipped.
 */
export async function staticPaths(appDir: string, scan: ExportScanner): Promise<{ paths: string[]; sources: string[] }> {
  const paths: string[] = [];
  const sources: string[] = [];

  (function walk(node: RouteNode, path: string, dynamic: boolean) {
    if (node.gated) return;
    if (dynamic && node.exports.has("paths")) sources.push(node.file!);
    if (!dynamic && node.exports.has("Page")) paths.push(path || "/");

    for (const child of node.children)
      walk(child, `${path}/${child.segment}`, dynamic || !!precedence(child.segment));
  })(await scanDir(appDir, "", "", scan), "", false);

  return { paths, sources };
}

function newNode(fields: Partial<RouteNode>): RouteNode {
  return { segment: "", name: "", exports: new Set(), classDefault: false, children: [], isLeaf: false, gated: false, alias: {}, ...fields };
}

async function scanDir(dir: string, segment: string, name: string, scan: ExportScanner): Promise<RouteNode> {
  const node = newNode({ segment, name });
  const entries = readdirSync(dir);

  if (entries.includes(REMOTE) && entries.some(entry => REMOTE_FILE.test(entry)))
    throw new Error(`${dir} has both a remote module and a remote/ folder - pick one.`);

  const entry = remoteEntry(dir, entries);

  node.gated = !!entry && hasGate(entry);

  for (const entry of entries) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      if (entry === REMOTE) continue;

      const tag = classify(entry, true)!;
      node.children.push(await scanDir(full, tag.segment, name + tag.label, scan));
      continue;
    }

    const ext = extname(entry);
    if (!ROUTE_EXT.has(ext)) continue;

    const tag = classify(basename(entry, ext), false);
    if (!tag) continue;

    const scanned = await scan(readFileSync(full, "utf8"), full);
    const exports = new Set(scanned.exports);
    const classDefault = !!scanned.classDefault;
    const { label } = scanned;

    if (exports.has("label") && typeof label != "string")
      throw new Error(`${full} exports a label that is not a string literal.`);

    if (tag.kind === "index") {
      node.file = full;
      node.exports = exports;
      node.classDefault = classDefault;
      node.label = label;
      continue;
    }

    node.children.push(newNode({
      segment: tag.segment,
      name: name + tag.label,
      file: full,
      exports,
      classDefault,
      label,
      isLeaf: true,
    }));
  }

  node.children.sort((a, b) => precedence(a.segment) - precedence(b.segment));

  return node;
}

function remoteEntry(dir: string, entries: string[]): string | undefined {
  const file = entries.find(entry => REMOTE_FILE.test(entry));

  if (file) return join(dir, file);
  if (!entries.includes(REMOTE) || !statSync(join(dir, REMOTE)).isDirectory()) return;

  const index = readdirSync(join(dir, REMOTE)).find(entry => REMOTE_INDEX.test(entry));

  return index && join(dir, REMOTE, index);
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

    const defaultSuffix = node.classDefault ? "Scope" : "Enter";
    const suffix = role === "default" ? defaultSuffix : role;
    let alias = role === "Page" ? base : base + suffix;
    while (used.has(alias)) alias += "_";

    used.add(alias);
    node.alias[role] = alias;
  }

  for (const child of node.children) assignAliases(child, used);
}

function collectImports(root: RouteNode, outDir: string) {
  const imports: string[] = [];
  const loaders: string[] = [];

  (function walk(node: RouteNode) {
    const roles = ROLES.filter(role => node.alias[role]);
    const router = node === root && node.exports.has("Router");

    if (node.file && (roles.length || router)) {
      const spec = JSON.stringify(importRel(outDir, node.file));
      if (lazy(node)) loaders.push(...roles.map(role => loaderFor(node, role, spec)));
      else imports.push(importFor(node, roles, spec, router));
    }

    node.children.forEach(walk);
  })(root);

  return { imports, loaders };
}

const isRoot = (node: RouteNode): boolean => !node.name;
const lazy = (node: RouteNode): boolean => !isRoot(node) && !node.alias.Loading && !node.alias.Catch;

function loaderFor(node: RouteNode, role: Role, spec: string): string {
  const load = role !== "default"
    ? `() => import(${spec}).then(m => m.${role})`
    : node.classDefault
      ? `() => import(${spec}).then(m => props => <Component for={m.default}>{props.children}</Component>)`
      : `route => import(${spec}).then(m => m.default(route))`;

  return `const ${node.alias[role]} = ${load};`;
}

function importFor(node: RouteNode, roles: Role[], spec: string, router: boolean): string {
  const named = roles.filter(role => role !== "default").map(role => `${role} as ${node.alias[role]}`);
  if (router) named.push("Router");
  const namedClause = named.length ? `{ ${named.join(", ")} }` : undefined;
  const clause = [node.alias.default, namedClause].filter(Boolean).join(", ");

  return `import ${clause} from ${spec};`;
}

const renders = (node: RouteNode): boolean => !!node.alias.Page || node.children.some(renders);

function scopedOf(node: RouteNode): string | undefined {
  const { Layout, default: def } = node.alias;

  if (node.classDefault && def && (Layout || !lazy(node))) return def + "d";
}

function provide(node: RouteNode, alias: string, content: string): string {
  return lazy(node)
    ? `<${alias}>${content}</${alias}>`
    : `<Component for={${alias}}>${content}</Component>`;
}

function collectWrappers(root: RouteNode): string[] {
  const wrappers: string[] = [];

  (function walk(node: RouteNode) {
    node.children.forEach(walk);

    if (!renders(node)) return;

    const { Layout, default: def } = node.alias;
    const scope = node.classDefault ? def : undefined;
    const scoped = scopedOf(node);

    if (scoped)
      wrappers.push(`const ${scoped} = props => ${provide(node, scope!, Layout ? `<${Layout} {...props} />` : "{props.children}")};`);
  })(root);

  return wrappers;
}

function emitNode(node: RouteNode, isRoot: boolean, depth: number, slot: string, outDir: string): string[] {
  const pad = "  ".repeat(depth);
  const { Page, Layout, Loading, Catch, NotFound, default: def } = node.alias;
  const label = node.label === undefined ? undefined : JSON.stringify(node.label);
  const hook = node.classDefault ? undefined : def;
  const load = node.gated && node.file && lazy(node) ? `, () => import(${JSON.stringify(importRel(outDir, node.file))})` : "";
  const enter = node.gated ? `checked(${hook ?? (load && "undefined")}${load})` : hook;
  const scope = node.classDefault ? def : undefined;

  const own = Loading ? `<${Loading} />` : undefined;
  const isScope = isRoot || node.children.length > 0 || !!Layout || !!NotFound || !!scope;

  if (!isScope)
    return Page ? route(pad, { to: node.segment, label, as: Page, enter, fallback: own ?? slot, Catch }) : [];

  const inner: string[] = [];
  const childSlot = own ?? (Layout ? "null" : slot);

  if (Page) inner.push(...route(pad + "  ", { as: Page, fallback: childSlot }));

  for (const child of node.children)
    inner.push(...emitNode(child, false, depth + 1, childSlot, outDir));

  if (!inner.length) return [];

  const as = scopedOf(node) ?? scope ?? Layout;
  const fallbackPage = NotFound ?? (isRoot ? "NotFound" : undefined);

  return route(
    pad,
    { to: isRoot ? undefined : node.segment, label, as, NotFound: fallbackPage, enter, fallback: slot, Catch },
    inner,
  );
}

interface RouteProps {
  to?: string;
  label?: string;
  as?: string;
  NotFound?: string;
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

export interface Remote {
  pattern: string[];
  module: string;
  folder: string;
  file: string;
}

export function remoteOf(appDir: string, file: string): Remote | undefined {
  if (!file.startsWith(appDir + sep) || !REMOTE_MODULE.test(file)) return;

  const parts = relative(appDir, file).split(sep);
  const at = parts.indexOf(REMOTE);
  const nested = at >= 0 && at < parts.length - 1;

  if (!nested && !REMOTE_FILE.test(parts.at(-1)!)) return;

  const folders = nested ? parts.slice(0, at) : parts.slice(0, -1);
  const module = nested ? parts.slice(at + 1).join("/").replace(REMOTE_MODULE, "").replace(/(^|\/)index$/, "") : "";

  return { pattern: folders.map(dir => classify(dir, true)!.segment), module, folder: join(appDir, ...folders), file };
}

export function remoteEntries(appDir: string): Remote[] {
  return readdirSync(appDir, { recursive: true, encoding: "utf8" }).flatMap(rel => {
    const remote = remoteOf(appDir, join(appDir, rel));
    return remote && !remote.module ? [remote] : [];
  });
}

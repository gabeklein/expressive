import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";

import { VERBS, type ApiRoute, type Exports } from "../server/api";
import { isClass as isClassNode, moduleOf, scanModule, type ErrorClass, type Sources, type Value } from "@expressive/rpc/vite";
import { scanExports } from "./scan";

const EXT = new Set([".ts", ".tsx", ".js", ".jsx"]);
const SKIP = /\.(test|spec)\.|\.d\.ts$/;

export interface ApiFile extends Omit<ApiRoute, "load"> {
  file: string;
}

/** A bare-named module under `api/` - a helper its routes import, never a route. `path` is where it would serve as a leaf. */
export interface ApiHelper {
  name: string;
  file: string;
  path: string[];
}

const OTHER = `${VERBS.join(", ")}, a default, async functions or Error subclasses`;

const served = (name: string) => name === "default" || VERBS.includes(name);

/**
 * What is wrong with a module's exports - `names` its runtime exports, `classDefault` whether its `default` is a class.
 * `declared` are the exports checked as calls and error classes elsewhere, `calls` how many are calls.
 */
export function problems(names: Iterable<string>, index: boolean, root: boolean, classDefault: boolean, declared: ReadonlySet<string> = new Set(), calls = 0): string[] {
  const found: string[] = [];
  const all = [...names];
  const verbs = all.filter(name => VERBS.includes(name));
  const gate = all.includes("default");

  for (const name of all)
    if (!served(name) && !declared.has(name))
      found.push(root && index
        ? `\`${name}\` - api/index.ts's other exports are reserved; export only verbs and a default gate.`
        : `\`${name}\` is not a route export - export ${OTHER}, and move helpers to a bare-named file beside it, like helpers.ts.`);

  if (index && classDefault) found.push("A folder's default is its gate - a function, not a class: export default () => { Session.new() }");
  if (!index && gate && verbs.length) found.push("A default answers every method - export it or verbs, not both.");
  if (!gate && !verbs.length && !calls) found.push(`No handler - export ${VERBS.join(", ")}, a default or an async function.`);

  return found;
}

/** Throw if a loaded module breaks the route rules, naming its file. */
export function verifyApi({ name, index, path }: Omit<ApiRoute, "load">, exports: Exports): void {
  const root = !path.length;
  const declared = new Set(root && index ? [] : Object.keys(exports).filter(key => !served(key) && typeof exports[key] == "function"));
  const wrong: string[] = [];
  let calls = 0;

  for (const key of declared)
    if (isClass(exports[key])) (exports[key] as Function).prototype instanceof Error || wrong.push(`${key} is a class but not an Error - only error classes reach the client.`);
    else if (Object.prototype.toString.call(exports[key]) === "[object AsyncFunction]") calls++;
    else wrong.push(`${key}() is not async - every call to it crosses the wire.`);

  const found = [...problems(Object.keys(exports), index, root, isClass(exports.default), declared, calls), ...wrong];

  for (const key of [...VERBS, "default"]) if (key in exports && typeof exports[key] != "function") found.push(`\`${key}\` is not a function.`);

  if (found.length) throw new Error(`${name}: ${found.join(" ")}`);
}

const isClass = (value: unknown) => typeof value == "function" && /^class\b/.test(Function.prototype.toString.call(value));

/** A route module's calls and error classes, and what is wrong with its exports. */
export interface RouteScan {
  calls: string[];
  errors: ErrorClass[];
  problems: string[];
}

const isFunction = (value: Value) => value?.type === "FunctionDeclaration" || value?.type === "FunctionExpression" || value?.type === "ArrowFunctionExpression";

/** Classify a route's exports: verbs and a default serve HTTP, async functions are calls, Error subclasses cross to the client beside them. */
export async function scanCalls({ file, index, path }: Pick<ApiFile, "file" | "index" | "path">, source: string, sources: Sources, owned: (file: string) => boolean): Promise<RouteScan> {
  const { exports: names, classDefault } = await scanExports(source, file);
  const { exports } = moduleOf(file, source);
  const root = index && !path.length;
  const declared = new Set(root ? [] : [...names].filter(name => !served(name) && (isFunction(exports.get(name)) || isClassNode(exports.get(name)))));
  const { calls, errors, problems: wrong } = await scanModule(file, source, sources, owned, {}, declared);
  const found = [...problems(names, index, root, !!classDefault, declared, calls.length), ...wrong];
  const param = path.find(part => part.startsWith(":") || part === "*");

  if (param && calls.length)
    found.push(`${calls.map(call => `${call}()`).join(", ")} - a call can't sit under ${param === "*" ? "[...]" : `[${param.slice(1)}]`}, which it has no page URL to fill from; move it to a static path and take the value as an argument.`);

  return { calls, errors, problems: found };
}

/** Every module under `dir` - routes and helpers - with what is wrong with their names. */
export function scanApi(root: string, dir = join(root, "api")): { routes: ApiFile[]; helpers: ApiHelper[]; problems: string[] } {
  const routes: ApiFile[] = [];
  const helpers: ApiHelper[] = [];
  const found: string[] = [];
  const served = new Map<string, string>();
  const name = (file: string) => relative(root, file).replaceAll("\\", "/");

  const add = (file: string, path: string[], index: boolean) => {
    const at = "/" + path.map(segment => (segment.startsWith(":") ? ":" : segment)).join("/");
    const other = served.get(at);

    if (other) found.push(`${other} and ${name(file)} serve the same path - keep one.`);
    else served.set(at, name(file));

    routes.push({ name: name(file), file, path, index });
  };

  (function walk(folder: string, path: string[]) {
    const params = new Set<string>();

    for (const entry of readdirSync(folder).sort()) {
      const full = join(folder, entry);
      const isDir = statSync(full).isDirectory();
      const ext = extname(entry);

      if (!isDir && (!EXT.has(ext) || SKIP.test(entry))) continue;

      const raw = isDir ? entry : basename(entry, ext);
      const leaf = isDir ? undefined : /^\((.+)\)$/.exec(raw)?.[1];
      const named = leaf ?? raw;
      const param = /^\[(.+)\]$/.exec(named)?.[1];
      const wrong =
        isDir && /^\(.*\)$/.test(raw) ? `api/ has no groups - name the folder ${raw.slice(1, -1)}/.` :
        raw === "()" ? `a leaf needs a name - (name)${ext}.` :
        leaf && /^[[(]/.test(leaf) ? `(name)${ext} takes a plain name - a param is [name]${ext}, the rest of a path [...]${ext}.` :
        /^[:*]/.test(named) ? `a name starting with : or * reads as a param - name a param [name], the rest of a path [...].` :
        param?.startsWith("...") && param !== "..." ? `[...] takes the rest of the path, unnamed - use [...] for a catch-all or [${param.slice(3)}] for one segment.` :
        param === "..." && isDir ? "[...] takes the rest of the path - make it a file, [...].ts." :
        undefined;

      if (wrong) {
        found.push(`${name(full)}: ${wrong}`);
        continue;
      }

      if (param === "...") {
        add(full, [...path, "*"], false);
        continue;
      }

      if (param) params.add(param);

      const segment = param ? `:${param}` : named;

      if (isDir) walk(full, [...path, segment]);
      else if (raw === "index") add(full, path, true);
      else if (leaf || param) add(full, [...path, segment], false);
      else helpers.push({ name: name(full), file: full, path: [...path, raw] });
    }

    if (params.size > 1) found.push(`${name(folder)}/: one [param] per folder - ${[...params].map(param => `[${param}]`).join(" and ")} would take the same segment.`);
  })(dir, []);

  return { routes, helpers, problems: found };
}

/** A helper's name as a leaf - `api/store.ts` as `api/(store).ts`. */
export const leafOf = (name: string) => name.replace(/([^/]+)(\.[jt]sx?)$/, "($1)$2");

/** The helper a path would reach if it were a route. */
export function helperAt(helpers: ApiHelper[], segments: string[]): ApiHelper | undefined {
  return helpers.find(({ path }) => path.length === segments.length && path.every((segment, i) => segment.startsWith(":") || segment === segments[i]));
}

const FUNCTION = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/** What is wrong with a helper - a function exported under a verb's name was meant as a route. */
export function helperProblems({ name, file }: ApiHelper, source: string): string[] {
  const { exports, errors } = moduleOf(file, source);

  if (errors.length) return [`${name}: ${errors[0]}`];

  const verbs = VERBS.filter(verb => FUNCTION.has(exports.get(verb)?.type as string));

  return verbs.length ? [`${name}: exports ${verbs.join(", ")}, but a bare-named file is a helper, not a route - rename it ${leafOf(name)} to serve it.`] : [];
}

const STAR = "re-exports with `export *` - list the verbs by name: export { GET } from \"...\".";

/** What is wrong with the folder - its names, each route's exports, and helpers that export verb handlers. */
export async function apiErrors(root: string, sources: Sources): Promise<string[]> {
  const { routes, helpers, problems: found } = scanApi(root);
  const owned = (file: string) => routes.some(route => route.file === file);

  for (const route of routes) {
    const source = readFileSync(route.file, "utf8");
    const star = moduleOf(route.file, source).body.some(node => node.type === "ExportAllDeclaration" && !node.exported && node.exportKind !== "type");
    const wrong = (await scanCalls(route, source, sources, owned)).problems.map(problem => (star && problem.startsWith("No handler") ? STAR : problem));

    if (wrong.length) found.push(`${route.name}: ${wrong.join(" ")}`);
  }

  for (const helper of helpers) found.push(...helperProblems(helper, readFileSync(helper.file, "utf8")));

  return found;
}

const RESERVED: Record<string, (entry: string) => boolean> = {
  app: entry => /^(api|\(api\)(\.[jt]sx?)?)$/.test(entry),
  public: entry => entry === "api",
};

/** Paths that would serve `/api` beside an `api/` folder, in any case. */
export function reservedApi(root: string): string[] {
  if (!existsSync(join(root, "api"))) return [];

  return Object.entries(RESERVED).flatMap(([dir, reserved]) =>
    (existsSync(join(root, dir)) ? readdirSync(join(root, dir)).sort() : [])
      .filter(entry => reserved(entry.toLowerCase()))
      .map(entry => `${dir}/${entry} would serve /api, which belongs to the api/ folder - move it.`));
}

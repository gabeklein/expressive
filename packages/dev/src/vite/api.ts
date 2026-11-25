import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";

import { VERBS, type ApiRoute, type Exports } from "../server/api";
import { scanExports } from "./scan";

const EXT = new Set([".ts", ".tsx", ".js", ".jsx"]);
const SKIP = /\.(test|spec)\.|\.d\.ts$/;

export interface ApiFile extends Omit<ApiRoute, "load"> {
  file: string;
}

/** What is wrong with a module's exports - `names` its runtime exports, `classDefault` whether its `default` is a class. */
export function problems(names: Iterable<string>, index: boolean, root: boolean, classDefault: boolean): string[] {
  const found: string[] = [];
  const all = [...names];
  const verbs = all.filter(name => VERBS.includes(name));
  const gate = all.includes("default");

  for (const name of all)
    if (name !== "default" && !VERBS.includes(name))
      found.push(root && index
        ? `\`${name}\` - api/index.ts's other exports are reserved; export only verbs and a default gate.`
        : `\`${name}\` is not a route export - export ${VERBS.join(", ")} or a default, and keep helpers outside api/.`);

  if (index && classDefault) found.push("A folder's default is its gate - a function, not a class: export default () => { Session.new() }");
  if (!index && gate && verbs.length) found.push("A default answers every method - export it or verbs, not both.");
  if (!gate && !verbs.length) found.push(`No handler - export ${VERBS.join(", ")} or a default.`);

  return found;
}

/** Throw if a loaded module breaks the route rules, naming its file. */
export function verifyApi({ name, index, path }: Omit<ApiRoute, "load">, exports: Exports): void {
  const found = problems(Object.keys(exports), index, !path.length, isClass(exports.default));

  for (const key of [...VERBS, "default"]) if (key in exports && typeof exports[key] != "function") found.push(`\`${key}\` is not a function.`);

  if (found.length) throw new Error(`${name}: ${found.join(" ")}`);
}

const isClass = (value: unknown) => typeof value == "function" && /^class\b/.test(Function.prototype.toString.call(value));

/** Every route module under `dir`, with what is wrong with their names. */
export function scanApi(root: string, dir = join(root, "api")): { routes: ApiFile[]; problems: string[] } {
  const routes: ApiFile[] = [];
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
      const param = /^\[(.+)\]$/.exec(raw)?.[1];
      const wrong =
        /^\(.*\)$/.test(raw) ? `api/ has no groups - name it ${raw.slice(1, -1)}${isDir ? "/" : ext}.` :
        /^[:*]/.test(raw) ? `a name starting with : or * reads as a param - name a param [name], the rest of a path [...].` :
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

      const segment = param ? `:${param}` : raw;

      if (isDir) walk(full, [...path, segment]);
      else if (raw === "index") add(full, path, true);
      else add(full, [...path, segment], false);
    }

    if (params.size > 1) found.push(`${name(folder)}/: one [param] per folder - ${[...params].map(param => `[${param}]`).join(" and ")} would take the same segment.`);
  })(dir, []);

  return { routes, problems: found };
}

/** What is wrong with the folder - its names, and each module's exports. */
export async function apiErrors(root: string): Promise<string[]> {
  const { routes, problems: found } = scanApi(root);

  for (const { file, name, index, path } of routes) {
    const { exports, classDefault } = await scanExports(readFileSync(file, "utf8"), file);
    const wrong = problems(exports, index, !path.length, !!classDefault);

    if (wrong.length) found.push(`${name}: ${wrong.join(" ")}`);
  }

  return found;
}

const RESERVED: Record<string, (entry: string) => boolean> = {
  app: entry => /^(api|\(api\))(\.[jt]sx?)?$/.test(entry),
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

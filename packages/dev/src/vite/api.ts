import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";

import { problems, type ApiRoute } from "../server/api";
import { scanExports } from "./scan";

const EXT = new Set([".ts", ".tsx", ".js", ".jsx"]);
const SKIP = /\.(test|spec)\.|\.d\.ts$/;

export interface ApiFile extends Omit<ApiRoute, "load"> {
  file: string;
}

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

      if (/^\(.*\)$/.test(raw)) {
        found.push(`${name(full)}: api/ has no groups - name it ${raw.slice(1, -1)}${isDir ? "/" : ext}.`);
        continue;
      }

      if (param === "...") {
        if (isDir) found.push(`${name(full)}: [...] takes the rest of the path - make it a file, [...].ts.`);
        else add(full, [...path, "*"], false);
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

const RESERVED = ["app/api", ...["api", "(api)"].flatMap(file => [...EXT].map(ext => `app/${file}${ext}`)), "public/api"];

/** Paths that would serve `/api` beside an `api/` folder. */
export function reservedApi(root: string): string[] {
  if (!existsSync(join(root, "api"))) return [];

  return RESERVED.filter(path => existsSync(join(root, path))).map(path => `${path} would serve /api, which belongs to the api/ folder - move it.`);
}

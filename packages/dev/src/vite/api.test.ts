import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Model } from "@expressive/mvc";

import { apiErrors, problems, reservedApi, scanApi, verifyApi } from "./api";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "api-"));
  dirs.push(root);

  for (const [path, src] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(path.endsWith("/") ? full : dirname(full), { recursive: true });
    if (!path.endsWith("/")) writeFileSync(full, src);
  }

  return root;
}

const GET = "export const GET = () => 1;";

describe("scanApi", () => {
  it("will route index, (name), [param] and [...] modules by location, and keep bare names as helpers", () => {
    const root = project({
      "api/index.ts": GET,
      "api/(logout).ts": GET,
      "api/photo/[id].tsx": GET,
      "api/auth/[...].js": GET,
      "api/account/index.jsx": GET,
      "api/account/(me).ts": GET,
      "api/account/store.ts": "export default {};",
      "api/account/me.test.ts": "",
      "api/account/me.spec.ts": "",
      "api/types.d.ts": "",
      "api/notes.md": "",
    });
    const { routes, helpers, problems } = scanApi(root);

    expect(problems).toEqual([]);
    expect(routes.map(({ name, path, index }) => [name, path, index])).toEqual([
      ["api/(logout).ts", ["logout"], false],
      ["api/account/(me).ts", ["account", "me"], false],
      ["api/account/index.jsx", ["account"], true],
      ["api/auth/[...].js", ["auth", "*"], false],
      ["api/index.ts", [], true],
      ["api/photo/[id].tsx", ["photo", ":id"], false],
    ]);
    expect(routes[0].file).toBe(join(root, "api/(logout).ts"));
    expect(helpers).toEqual([{ name: "api/account/store.ts", file: join(root, "api/account/store.ts") }]);
  });

  it("will refuse groups, a [...] folder, two modules on one path and two params in a folder", () => {
    const { problems } = scanApi(project({
      "api/(group)/a.ts": GET,
      "api/([id]).ts": GET,
      "api/[...]/index.ts": GET,
      "api/(dev).ts": GET,
      "api/dev/index.ts": GET,
      "api/(log).ts": GET,
      "api/log/(x).ts": GET,
      "api/item/[id].ts": GET,
      "api/item/[slug]/(x).ts": GET,
      "api/:x.ts": GET,
      "api/(*).ts": GET,
      "api/[...rest].ts": GET,
    }));

    expect(problems).toEqual([
      "api/(*).ts: a name starting with : or * reads as a param - name a param [name], the rest of a path [...].",
      "api/([id]).ts: (name).ts takes a plain name - a param is [name].ts, the rest of a path [...].ts.",
      "api/(group): api/ has no groups - name the folder group/.",
      "api/:x.ts: a name starting with : or * reads as a param - name a param [name], the rest of a path [...].",
      "api/[...]: [...] takes the rest of the path - make it a file, [...].ts.",
      "api/[...rest].ts: [...] takes the rest of the path, unnamed - use [...] for a catch-all or [rest] for one segment.",
      "api/(dev).ts and api/dev/index.ts serve the same path - keep one.",
      "api/item/: one [param] per folder - [id] and [slug] would take the same segment.",
    ]);
  });
});

describe("apiErrors", () => {
  it("will name modules whose exports break the rules, ignoring type exports", async () => {
    const root = project({
      "api/index.ts": "export default () => {}; export const spec = {};",
      "api/(ok).ts": "export type Item = { id: string }; export interface Shape {} export const GET = () => 1;",
      "api/(empty).ts": "export type Item = {};",
      "api/gate/index.ts": "import { Model } from '@expressive/mvc'; export default class Session extends Model {}",
      "api/(group)/a.ts": GET,
    });

    expect(await apiErrors(root)).toEqual([
      "api/(group): api/ has no groups - name the folder group/.",
      "api/(empty).ts: No handler - export GET, POST, PUT, PATCH, DELETE, OPTIONS or a default.",
      "api/gate/index.ts: A folder's default is its gate - a function, not a class: export default () => { Session.new() }",
      "api/index.ts: `spec` - api/index.ts's other exports are reserved; export only verbs and a default gate.",
    ]);
  });

  it("will refuse a helper exporting a verb, but not one exporting anything else", async () => {
    const root = project({
      "api/(ok).ts": "import { db } from './store'; export const GET = () => db;",
      "api/store.ts": "export const db = {}; export default db; export class Row {}",
      "api/users/hello.tsx": "export const GET = () => 1; export function POST() {}",
    });

    expect(await apiErrors(root)).toEqual([
      "api/users/hello.tsx: exports GET, POST, but a bare-named file is a helper, not a route - rename it api/users/(hello).tsx to serve it.",
    ]);
  });
});

describe("reservedApi", () => {
  it("will name what would serve /api beside an api/ folder, in any case", () => {
    const files = { "app/api/": "", "app/(api)/": "", "app/api.tsx": "", "app/(api).ts": "", "public/api/": "", "app/apis.tsx": "" };

    expect(reservedApi(project({ ...files, "api/index.ts": GET }))).toEqual([
      "app/(api) would serve /api, which belongs to the api/ folder - move it.",
      "app/(api).ts would serve /api, which belongs to the api/ folder - move it.",
      "app/api would serve /api, which belongs to the api/ folder - move it.",
      "public/api would serve /api, which belongs to the api/ folder - move it.",
    ]);
    expect(reservedApi(project({ "app/(API).tsx": "", "public/Api/": "", "api/index.ts": GET }))).toEqual([
      "app/(API).tsx would serve /api, which belongs to the api/ folder - move it.",
      "public/Api would serve /api, which belongs to the api/ folder - move it.",
    ]);
    expect(reservedApi(project({ "api/index.ts": GET }))).toEqual([]);
    expect(reservedApi(project(files))).toEqual([]);
  });
});

describe("problems", () => {
  it("will name exports a route does not read, reserving api/index.ts's", () => {
    expect(problems(["GET", "Get"], false, false, false)).toEqual(["`Get` is not a route export - export GET, POST, PUT, PATCH, DELETE, OPTIONS or a default, and move helpers to a bare-named file beside it, like helpers.ts."]);
    expect(problems(["default", "spec"], true, true, false)).toEqual(["`spec` - api/index.ts's other exports are reserved; export only verbs and a default gate."]);
    expect(problems(["default", "spec"], true, false, false)).toEqual(["`spec` is not a route export - export GET, POST, PUT, PATCH, DELETE, OPTIONS or a default, and move helpers to a bare-named file beside it, like helpers.ts."]);
  });

  it("will refuse a class gate, a catch-all beside verbs and a module with no handler, but pass a gate alone", () => {
    expect(problems(["default"], true, false, true)).toEqual(["A folder's default is its gate - a function, not a class: export default () => { Session.new() }"]);
    expect(problems(["default", "GET"], false, false, false)).toEqual(["A default answers every method - export it or verbs, not both."]);
    expect(problems([], false, false, false)).toEqual(["No handler - export GET, POST, PUT, PATCH, DELETE, OPTIONS or a default."]);
    expect(problems([], true, false, false)).toEqual(["No handler - export GET, POST, PUT, PATCH, DELETE, OPTIONS or a default."]);
    expect(problems(["default"], true, false, false)).toEqual([]);
    expect(problems(["default", "GET"], true, false, false)).toEqual([]);
  });
});

describe("verifyApi", () => {
  it("will throw for a class gate, imported or not, and a handler that is not a function", () => {
    class Session extends Model {}
    const route = (index: boolean) => ({ name: "api/a.ts", path: ["a"], index });

    expect(() => verifyApi(route(true), { default: Session })).toThrow("api/a.ts: A folder's default is its gate - a function, not a class");
    expect(() => verifyApi(route(false), { GET: "hi" })).toThrow("api/a.ts: `GET` is not a function.");
    expect(() => verifyApi(route(false), { GET: () => {} })).not.toThrow();
  });
});

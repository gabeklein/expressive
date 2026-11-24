import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { apiErrors, reservedApi, scanApi } from "./api";

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
  it("will route every module by location, skipping tests, specs, declarations and other files", () => {
    const root = project({
      "api/index.ts": GET,
      "api/logout.ts": GET,
      "api/photo/[id].tsx": GET,
      "api/auth/[...].js": GET,
      "api/account/index.jsx": GET,
      "api/account/me.ts": GET,
      "api/account/me.test.ts": "",
      "api/account/me.spec.ts": "",
      "api/types.d.ts": "",
      "api/notes.md": "",
    });
    const { routes, problems } = scanApi(root);

    expect(problems).toEqual([]);
    expect(routes.map(({ name, path, index }) => [name, path, index])).toEqual([
      ["api/account/index.jsx", ["account"], true],
      ["api/account/me.ts", ["account", "me"], false],
      ["api/auth/[...].js", ["auth", "*"], false],
      ["api/index.ts", [], true],
      ["api/logout.ts", ["logout"], false],
      ["api/photo/[id].tsx", ["photo", ":id"], false],
    ]);
    expect(routes[0].file).toBe(join(root, "api/account/index.jsx"));
  });

  it("will refuse groups, a [...] folder, two modules on one path and two params in a folder", () => {
    const { problems } = scanApi(project({
      "api/(admin).ts": GET,
      "api/(group)/a.ts": GET,
      "api/[...]/index.ts": GET,
      "api/dev.ts": GET,
      "api/dev/index.ts": GET,
      "api/item/[id].ts": GET,
      "api/item/[slug]/x.ts": GET,
    }));

    expect(problems).toEqual([
      "api/(admin).ts: api/ has no groups - name it admin.ts.",
      "api/(group): api/ has no groups - name it group/.",
      "api/[...]: [...] takes the rest of the path - make it a file, [...].ts.",
      "api/dev/index.ts and api/dev.ts serve the same path - keep one.",
      "api/item/: one [param] per folder - [id] and [slug] would take the same segment.",
    ]);
  });
});

describe("apiErrors", () => {
  it("will name modules whose exports break the rules, ignoring type exports", async () => {
    const root = project({
      "api/index.ts": "export default () => {}; export const spec = {};",
      "api/ok.ts": "export type Item = { id: string }; export interface Shape {} export const GET = () => 1;",
      "api/empty.ts": "export type Item = {};",
      "api/gate/index.ts": "import { Model } from '@expressive/mvc'; export default class Session extends Model {}",
      "api/(x).ts": GET,
    });

    expect(await apiErrors(root)).toEqual([
      "api/(x).ts: api/ has no groups - name it x.ts.",
      "api/empty.ts: No handler - export GET, POST, PUT, PATCH, DELETE, OPTIONS or a default.",
      "api/gate/index.ts: A folder's default is its gate - a function, not a class: export default () => { Session.new() }",
      "api/index.ts: `spec` - api/index.ts's other exports are reserved; export only verbs and a default gate.",
    ]);
  });
});

describe("reservedApi", () => {
  it("will name what would serve /api beside an api/ folder", () => {
    const files = { "app/api/": "", "app/api.tsx": "", "app/(api).ts": "", "public/api/": "", "app/apis.tsx": "" };

    expect(reservedApi(project({ ...files, "api/index.ts": GET }))).toEqual([
      "app/api would serve /api, which belongs to the api/ folder - move it.",
      "app/api.tsx would serve /api, which belongs to the api/ folder - move it.",
      "app/(api).ts would serve /api, which belongs to the api/ folder - move it.",
      "public/api would serve /api, which belongs to the api/ folder - move it.",
    ]);
    expect(reservedApi(project(files))).toEqual([]);
  });
});

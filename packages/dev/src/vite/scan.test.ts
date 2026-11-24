import { describe, expect, it } from "vitest";
import type { Sources } from "@expressive/rpc/vite";

import { remoteOf } from "./routes";
import { gateProblems, scanGate, scanRemote } from "./scan";

const files = (map: Record<string, string>): Sources => ({
  resolve: async (spec, importer) => {
    const file = new URL(spec.endsWith(".js") ? spec : `${spec}.ts`, `file://${importer}`).pathname;
    return file in map || file.replace(/\.js$/, ".d.ts") in map ? file : undefined;
  },
  read: file => {
    if (!(file in map)) throw new Error(`No ${file}`);
    return map[file];
  },
});

const MVC = `import { Model } from "@expressive/mvc";`;

describe("remote scan", () => {
  const at = (file: string) => remoteOf("/app", file);
  const scan = (source: string, file = "/app/tally/remote.ts", map: Record<string, string> = {}) => scanRemote(at(file)!, source, files(map), at);

  it("will leave calls and error classes to rpc's scanner", async () => {
    expect(await scan(`
      import { HttpError } from "@expressive/rpc";
      export class Over extends Error {}
      export class Payment extends HttpError {}
      export async function add() {}
    `)).toEqual({
      calls: ["add"],
      errors: [{ name: "Over" }, { name: "Payment", parent: { id: "http:HttpError" } }],
      gate: false,
      problems: [],
    });
  });

  it("will take a default subclass as the folder's gate, however exported", async () => {
    expect(await scan(`${MVC} export default class Tally extends Model { async add() {} }`)).toMatchObject({ gate: true, calls: [], problems: [] });
    expect(await scan(`${MVC} class A extends Model {} export { A as default }`)).toMatchObject({ gate: true, problems: [] });
    expect(await scan(`${MVC} class B extends Model {} export default B`)).toMatchObject({ gate: true, problems: [] });
    expect(await scan(`${MVC} export default class extends Model {}`)).toMatchObject({ gate: true, problems: [] });
  });

  it("will refuse a default that is not a subclass", async () => {
    const problem = "A remote default is its folder's gate - a Model subclass whose static key() admits each call.";

    expect((await scan(`export default async () => {}`)).problems).toEqual([problem]);
    expect((await scan(`export default class {}`)).problems).toEqual([problem]);
  });

  it("will refuse a default outside the folder's remote entry", async () => {
    expect((await scan(`${MVC} export default class A extends Model {}`, "/app/tally/remote/bar.ts")).problems).toEqual([
      "Only a folder's remote entry - remote.ts or remote/index.ts - may export a default.",
    ]);
  });

  it("will refuse an exported Model class", async () => {
    const { problems, errors } = await scan(`${MVC} export class Cart extends Model { async add() {} } export class Over extends Error {}`);

    expect(problems).toEqual([expect.stringMatching(/^Cart is a class but not an Error/)]);
    expect(errors).toEqual([{ name: "Over" }]);
  });

  it("will not take a base imported as a type only", async () => {
    const map = {
      "/app/tally/errors.ts": `import { HttpError } from "@expressive/rpc"; export class Failed extends HttpError {}`,
      "/app/tally/base.ts": `${MVC} export class Base extends Model { async add() {} }`,
    };
    const found = await scan(`
      import type { Failed } from "./errors";
      import type { Base } from "./base";
      export class X extends Failed {}
      export default class Tally extends Base {}
      export async function list() {}
    `, undefined, map);

    expect(found).toEqual({
      calls: ["list"],
      errors: [],
      gate: true,
      problems: [
        "X extends Failed, which is neither declared nor imported.",
        "Tally extends Base, which is neither declared nor imported in /app/tally/remote.ts.",
      ],
    });
  });

  it("will take an error's parent from a sidecar in its folder or above, and none from a sibling folder", async () => {
    const map = {
      "/app/remote.ts": `import { HttpError } from "@expressive/rpc"; export class Billing extends HttpError {}`,
      "/app/shop/remote.ts": `import { HttpError } from "@expressive/rpc"; export class Sold extends HttpError {}`,
    };
    const { errors } = await scan(`
      import { Billing } from "../remote";
      import { Sold } from "../shop/remote";
      export class Late extends Billing {}
      export class Gone extends Sold {}
    `, undefined, map);

    expect(errors).toEqual([
      { name: "Late", parent: { file: "/app/remote.ts", name: "Billing" } },
      { name: "Gone", parent: { id: "http:HttpError" } },
    ]);
  });
});

describe("remote entry's default alone", () => {
  const at = (file: string) => remoteOf("/app", file)!;
  const gate = (source: string, file = "/app/remote.ts") => scanGate(at(file), source, files({}));

  it("will check a default without its exports, and refuse one re-exported", async () => {
    expect(await gate(`${MVC} export default class Site extends Model {} export const x = 1;`)).toEqual({ gate: true, problems: [] });
    expect(await gate("export async function add() {}")).toEqual({ gate: false, problems: [] });
    expect(await gate("export default () => true;")).toEqual({ gate: false, problems: [expect.stringMatching(/^A remote default is its folder's gate/)] });
    expect(await gate("export default class Site extends Error {}")).toEqual({ gate: true, problems: ["Site extends Error, which is neither declared nor imported in /app/remote.ts."] });
    expect(await gate(`export { default } from "./site";`)).toEqual({ gate: false, problems: [expect.stringMatching(/re-exported one is not checked/)] });
    expect(await gate(`export { Site as "default" } from "./site";`)).toMatchObject({ gate: false });
    expect(await gate(`export { a } from "./a";`)).toEqual({ gate: false, problems: [] });
  });
});

describe("gate scan", () => {
  const gate = (source: string, map: Record<string, string> = {}) => gateProblems(source, "/app/remote.ts", files(map));
  const HEAD = `import { Model } from "@expressive/mvc";`;

  it("will follow a default's bases in its module, through imports and compiled declarations", async () => {
    expect(await gate(`${HEAD} class Base extends Model {} const Mid = class extends Base {}; export default class Tally extends Mid {}`)).toEqual([]);
    expect(await gate(`import { Base } from "./base"; export default class Tally extends Base {}`, {
      "/app/base.ts": `${HEAD} export class Base extends Model {}`,
    })).toEqual([]);
    expect(await gate(`import { Base } from "./lib/base.js"; export default class Tally extends Base {}`, {
      "/app/lib/base.js": "export class Base extends Model {}",
      "/app/lib/base.d.ts": `${HEAD} export declare class Base extends Model {}`,
    })).toEqual([]);
    expect(await gate(`import { Base } from "./plain.js"; export default class Tally extends Base {}`, {
      "/app/plain.js": `${HEAD} export class Base extends Model {}`,
    })).toEqual([]);
  });

  it("will report a base it cannot follow", async () => {
    expect(await gate(`${HEAD} const mix = (B: any) => B; export default class A extends mix(Model) {}`)).toEqual([
      "A extends an expression - name its base class.",
    ]);
    expect(await gate(`export default class A extends Missing {}`)).toEqual([
      "A extends Missing, which is neither declared nor imported in /app/remote.ts.",
    ]);
    expect(await gate(`import { B } from "./nowhere"; export default class A extends B {}`)).toEqual([
      'A extends B from "./nowhere", which does not resolve.',
    ]);
    expect(await gate(`import { B } from "./b"; export default class A extends B {}`, { "/app/b.ts": "export const B = 1;" })).toEqual([
      "A extends B, which /app/b.ts does not export as a class.",
    ]);
    expect(await gate(`class Plain {} export default class A extends Plain {}`)).toEqual([
      "Plain extends no class - a folder's default must be a Model.",
    ]);
  });

  it("will refuse a default whose bases extend themselves", { timeout: 1000 }, async () => {
    const map: Record<string, string> = {
      "/app/a.ts": `import { B } from "./b"; export class A extends B {}`,
      "/app/b.ts": `import { A } from "./a"; export class B extends A {}`,
    };
    const sources: Sources = {
      resolve: spec => new Promise(done => setTimeout(done, 0, `/app/${spec.slice(2)}.ts`)),
      read: file => map[file],
    };

    expect(await gateProblems(`import { A } from "./a"; export default class Tally extends A {}`, "/app/remote.ts", sources)).toEqual([
      "A extends B, which extends A - a class cannot extend itself.",
    ]);
  });

  it("will name an anonymous default in a loop of bases", async () => {
    expect(await gate(`import A from "./a"; export default class Tally extends A {}`, {
      "/app/a.ts": `import B from "./b"; export default class extends B {}`,
      "/app/b.ts": `import A from "./a"; export default class B extends A {}`,
    })).toEqual(["default extends B, which extends default - a class cannot extend itself."]);
  });

  it("will refuse a default that extends an http error", async () => {
    expect(await gate(`
      import { Forbidden } from "@expressive/rpc";
      export default class Gate extends Forbidden {}
    `)).toEqual(["Gate extends Forbidden, an error class - a folder's default must be a Model."]);
  });

  it("will take a default extending a root class that is not an http error, as Current", async () => {
    expect(await gate(`
      import { Current } from "@expressive/rpc";
      export default class Gate extends Current {}
    `)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import type { Sources } from "@expressive/rpc/vite";

import { remoteOf } from "./routes";
import { NOT_GATE, scanGate, scanRemote } from "./scan";

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

  it("will take a default function as the folder's gate, however exported", async () => {
    expect(await scan(`export default () => {}`)).toMatchObject({ gate: true, calls: [], problems: [] });
    expect(await scan(`export default async function gate() {}`)).toMatchObject({ gate: true, problems: [] });
    expect(await scan(`function gate() {} export { gate as default }`)).toMatchObject({ gate: true, problems: [] });
    expect(await scan(`const gate = () => {}; export default gate`)).toMatchObject({ gate: true, problems: [] });
  });

  it("will refuse a default that is not a function", async () => {
    expect((await scan(`${MVC} export default class Tally extends Model {}`)).problems).toEqual([NOT_GATE]);
    expect((await scan(`export default 1`)).problems).toEqual([NOT_GATE]);
  });

  it("will refuse a default outside the folder's remote entry", async () => {
    expect((await scan(`export default () => {}`, "/app/tally/remote/bar.ts")).problems).toEqual([
      "Only a folder's remote entry - remote.ts or remote/index.ts - may export a default.",
    ]);
  });

  it("will refuse an exported Model class", async () => {
    const { problems, errors } = await scan(`${MVC} export class Cart extends Model { async add() {} } export class Over extends Error {}`);

    expect(problems).toEqual([expect.stringMatching(/^Cart is a class but not an Error/)]);
    expect(errors).toEqual([{ name: "Over" }]);
  });

  it("will not take an error base imported as a type only", async () => {
    const map = {
      "/app/tally/errors.ts": `import { HttpError } from "@expressive/rpc"; export class Failed extends HttpError {}`,
    };
    const found = await scan(`
      import type { Failed } from "./errors";
      export class X extends Failed {}
      export async function list() {}
    `, undefined, map);

    expect(found).toEqual({
      calls: ["list"],
      errors: [],
      gate: false,
      problems: ["X extends Failed, which is neither declared nor imported."],
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
  const gate = (source: string, file = "/app/remote.ts") => scanGate(remoteOf("/app", file)!, source);

  it("will check a default without its exports, and refuse one re-exported", () => {
    expect(gate("export default () => {}; export const x = 1;")).toEqual({ gate: true, problems: [] });
    expect(gate("export async function add() {}")).toEqual({ gate: false, problems: [] });
    expect(gate(`${MVC} export default class Site extends Model {}`)).toEqual({ gate: false, problems: [NOT_GATE] });
    expect(gate(`export { default } from "./site";`)).toEqual({ gate: false, problems: [expect.stringMatching(/re-exported one is not checked/)] });
    expect(gate(`export { gate as "default" } from "./site";`)).toMatchObject({ gate: false });
    expect(gate(`export { a } from "./a";`)).toEqual({ gate: false, problems: [] });
  });
});

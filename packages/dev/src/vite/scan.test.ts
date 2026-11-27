import { describe, expect, it } from "vitest";
import type { Sources } from "@expressive/rpc/vite";

import { remoteOf } from "./routes";
import { NOT_GATE, scanExports, scanGate, scanRemote } from "./scan";

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

describe("route default placing children", () => {
  const drops = async (source: string) => (await scanExports(source, "/app/index.tsx")).dropsChildren;
  const COMPONENT = `import { Component, Model } from "@expressive/mvc";`;

  it("will find a function default that never reads its children", async () => {
    expect(await drops("export default function Frame() { return <main />; }")).toBe(true);
    expect(await drops("export default ({ title }) => <h1>{title}</h1>;")).toBe(true);
    expect(await drops("export default (props = {}) => <h1>{props.title}</h1>;")).toBe(true);
    expect(await drops("const Frame = props => <main />; export default Frame;")).toBe(true);
  });

  it("will take any read of a function default's children, or its props whole, as placing", async () => {
    for (const source of [
      "export default ({ children }) => <main>{children}</main>;",
      "export default ({ 'children': kids }) => <main>{kids}</main>;",
      "export default ({ title, ...rest }) => <Frame {...rest} />;",
      "export default props => <main>{props.children}</main>;",
      "export default props => <main>{props['children']}</main>;",
      "export default props => <Frame {...props} />;",
      "export default props => props;",
      "export default function Frame() { return arguments[0].children; }",
      "export default ([props]) => <main />;",
      "export default function Frame(props) { const { children } = props; return <main>{children}</main>; }",
      "export default function Frame({ open }) { return open ? children : <button />; }",
      "export default async function Frame({ children }) { await load(); return children; }",
    ])
      expect(await drops(source)).toBe(false);
  });

  it("will find a Component default whose render never reads its children", async () => {
    expect(await drops(`${COMPONENT} export default class Frame extends Component { render() { return <main />; } }`)).toBe(true);
    expect(await drops(`${COMPONENT} export default class Frame extends Component { render = () => <main />; }`)).toBe(true);
    expect(await drops(`${COMPONENT} export default class Frame extends Component { render(props) { return <main>{props.title}</main>; } }`)).toBe(true);
  });

  it("will take a Component default's render reading children, props, or its parent's render as placing", async () => {
    for (const render of [
      "render() { return <main>{this.props.children}</main>; }",
      "render() { const { children } = this.props; return children; }",
      "render() { return this.children; }",
      "render() { return <Frame {...this.props} />; }",
      "render() { return <main>{super.render()}</main>; }",
      "render(props) { return <main>{props.children}</main>; }",
      "render({ children }) { return this.open ? children : <button />; }",
    ])
      expect(await drops(`${COMPONENT} export default class Frame extends Component { ${render} }`)).toBe(false);
  });

  it("will leave a default it cannot read alone", async () => {
    for (const source of [
      `${COMPONENT} export default class Session extends Model { render() { return null; } }`,
      `${COMPONENT} export default class Frame extends Component {}`,
      `${COMPONENT} export default class Frame extends Component { render = Other; }`,
      `${COMPONENT} export default class Frame extends Component { ["render"]() { return null; } }`,
      `import Frame from "./frame"; export default Frame;`,
      `export { default } from "./frame";`,
      `export default memo(() => <main />);`,
      `export const Page = () => <main />;`,
    ])
      expect(await drops(source)).toBe(false);
  });
});

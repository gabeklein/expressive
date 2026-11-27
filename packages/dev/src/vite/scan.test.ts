import { describe, expect, it } from "vitest";

import { scanExports } from "./scan";

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

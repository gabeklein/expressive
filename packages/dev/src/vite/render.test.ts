import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { launch } from "./render";

const PACKAGES = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = `export default {
  resolve: {
    alias: [
      { find: /^@expressive\\/([^/]+)$/, replacement: ${JSON.stringify(PACKAGES)} + "$1/src" },
      { find: /^@expressive\\/([^/]+)\\/(.+)$/, replacement: ${JSON.stringify(PACKAGES)} + "$1/src/$2" },
    ],
  },
};
`;

describe("launch", { timeout: 30_000 }, () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  function project(files: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), "prerender-"));
    dirs.push(root);

    for (const [file, source] of Object.entries({ "vite.config.mjs": CONFIG, ...files })) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), source);
    }

    return root;
  }

  it("will render a routed page at its path with the rules and head elements it used", async () => {
    const root = project({
      "app/index.tsx": `
        import { style } from "@expressive/dev";
        export const Page = () => <h1>home</h1>;
        export function Layout(props) { return <main><title>Site</title>{props.children}</main>; }
        style(Layout, { color: "teal" });
      `,
      "app/(about).tsx": `export const Page = () => <h2>about</h2>;`,
      "app/blog/[slug].tsx": `
        import { Route } from "@expressive/dev";
        export const Page = () => <h3>{Route.get().match.slug}</h3>;
        export const paths = async () => ["/blog/a", "/blog/b"];
      `,
    });
    const renderer = await launch(root);

    expect(await renderer.paths()).toEqual(["/blog/a", "/blog/b"]);
    expect((await renderer.render("/blog/b"))!.html).toContain("<h3>b</h3>");

    const about = (await renderer.render("/about"))!;

    expect(about).toMatchObject({ path: "/about", css: ".Layout{color: teal;}", head: "<title>Site</title>" });
    expect(about.html).toMatch(/<main class="Layout">.*<h2>about<\/h2>.*<\/main>/);
    expect(about.html).not.toContain("<h1>");

    renderer.close();
    expect(existsSync(join(root, "dist", ".prerender"))).toBe(false);
  });

  it("will report where a page redirects", async () => {
    const root = project({
      "app/index.tsx": `export const Page = () => <p>home</p>;`,
      "app/(old).tsx": `import { Redirect } from "@expressive/dev"; export const Page = () => <Redirect to="/" />;`,
    });
    const renderer = await launch(root);

    expect(await renderer.render("/old")).toMatchObject({ path: "/" });
    expect(await renderer.render("/")).toMatchObject({ path: "/" });
    renderer.close();
  });

  it("will render pages beside a root remote and return null for one that calls it", async () => {
    const root = project({
      "app/remote.ts": `
        import { Model } from "@expressive/mvc";
        export async function user() { return "ada"; }
        export async function slugs() { return ["a"]; }
        export class Cart extends Model { items = 0; async add() {} }
      `,
      "app/index.tsx": `
        export function Layout(props) { return <main>{props.children}</main>; }
        export function Catch() { return <p>oops</p>; }
      `,
      "app/(privacy).tsx": `import { user } from "./remote"; export const Page = () => <p onClick={() => user()}>private</p>;`,
      "app/(account).tsx": `
        import { Component, set } from "@expressive/mvc";
        import { user } from "./remote";
        export class Page extends Component { name = set(() => user()); render() { return <p>{this.name}</p>; } }
      `,
      "app/(cart).tsx": `
        import { Component } from "@expressive/mvc";
        import { Cart } from "./remote";
        export class Page extends Component { cart = new Cart(); render() { return <p>{this.cart.items}</p>; } }
      `,
      "app/(shelf).tsx": `
        import { Component } from "@expressive/mvc";
        import { Cart } from "./remote";
        export class Page extends Component { cart = new Cart(); render() { return <button onClick={() => this.cart.add()}>shelf</button>; } }
      `,
      "app/(caught).tsx": `
        import { Component, set } from "@expressive/mvc";
        import { user } from "./remote";
        export class Page extends Component {
          name = set(() => user());
          catch() {}
          render() { return <p>{this.name}</p>; }
        }
      `,
      "app/(later).tsx": `
        import { Component } from "@expressive/mvc";
        import { user } from "./remote";
        export class Page extends Component { new() { user(); } render() { return <p>later</p>; } }
      `,
      "app/blog/[slug].tsx": `
        import { slugs } from "../remote";
        export const Page = () => <p>post</p>;
        export const paths = () => slugs();
      `,
      "app/docs/[id].tsx": `export const Page = () => <p>doc</p>; export const paths = async () => ["/docs/1"];`,
      "app/notes/[id].tsx": `export const Page = () => <p>note</p>; export const paths = () => "/notes/1";`,
      "app/(timer).tsx": `
        import { Component } from "@expressive/mvc";
        import { user } from "./remote";
        export class Page extends Component { new() { setTimeout(() => user(), 10); } render() { return <p>timer</p>; } }
      `,
      "app/(slow).tsx": `
        import { Component, set } from "@expressive/mvc";
        export class Page extends Component {
          value = set(() => new Promise(resolve => setTimeout(() => resolve("slow"), 40)));
          render() { return <p>{this.value}</p>; }
        }
      `,
    });
    const renderer = await launch(root);

    expect(await renderer.paths()).toEqual(["/docs/1", "/notes/1"]);
    expect((await renderer.render("/privacy"))?.html).toContain("<p>private</p>");
    expect(await renderer.render("/account")).toBeNull();
    expect(await renderer.render("/cart")).toBeNull();
    expect((await renderer.render("/shelf"))?.html).toContain("shelf</button>");
    expect(await renderer.render("/caught")).toBeNull();
    expect(await renderer.render("/later")).toBeNull();
    expect((await renderer.render("/docs/1"))?.html).toContain("<p>doc</p>");
    expect((await renderer.render("/timer"))?.html).toContain("<p>timer</p>");
    expect((await renderer.render("/slow"))?.html).toContain("<p>slow</p>");
    renderer.close();
  });

  it("will render a page under a seat until it reads the seat", async () => {
    const root = project({
      "app/remote.ts": `
        import { Model } from "@expressive/mvc";
        export default class Site extends Model { visits = 0; async visit() {} }
      `,
      "app/index.tsx": `export const Page = () => <p>home</p>;`,
      "app/(stats).tsx": `
        import { Component, get } from "@expressive/mvc";
        import Site from "./remote";
        export class Page extends Component { site = get(Site); render() { return <p>{this.site.visits}</p>; } }
      `,
      "app/(visit).tsx": `
        import { Component, get } from "@expressive/mvc";
        import Site from "./remote";
        export class Page extends Component { site = get(Site); new() { this.site.visit(); } render() { return <p>visit</p>; } }
      `,
      "app/(snapshot).tsx": `
        import { Component, get } from "@expressive/mvc";
        import Site from "./remote";
        export class Page extends Component { site = get(Site); render() { return <p>{JSON.stringify(this.site.get())}</p>; } }
      `,
      "app/(field).tsx": `
        import { Component, get } from "@expressive/mvc";
        import Site from "./remote";
        export class Page extends Component { site = get(Site); render() { return <p>{this.site.get("visits")}</p>; } }
      `,
      "app/members/remote.ts": `import { Model } from "@expressive/mvc"; export default class Member extends Model { member = false; }`,
      "app/members/index.tsx": `
        export default route => (route.remote.member ? undefined : "/");
        export const Page = () => <p>members</p>;
      `,
    });
    const renderer = await launch(root);

    expect((await renderer.render("/"))?.html).toContain("<p>home</p>");
    expect(await renderer.render("/stats")).toBeNull();
    expect(await renderer.render("/visit")).toBeNull();
    expect(await renderer.render("/snapshot")).toBeNull();
    expect(await renderer.render("/field")).toBeNull();
    expect(await renderer.render("/members")).toBeNull();
    renderer.close();
  });

  it("will still throw what a page throws without calling the server", async () => {
    const root = project({
      "app/remote.ts": `export async function user() { return "ada"; }`,
      "app/index.tsx": `export const Page = () => { throw new Error("broke"); };`,
      "app/blog/[slug].tsx": `export const Page = () => null; export const paths = async () => { throw new Error("no list"); };`,
    });
    const renderer = await launch(root);

    await expect(renderer.render("/")).rejects.toThrow("broke");
    await expect(renderer.paths()).rejects.toThrow("no list");
    renderer.close();
  });

  it("will render a single-file app and list no paths", async () => {
    const renderer = await launch(project({ "app.tsx": `export default () => <p>solo</p>;` }));

    expect(await renderer.paths()).toEqual([]);
    expect((await renderer.render("/"))!.html).toContain("<p>solo</p>");
    renderer.close();
  });

  it("will clean up if the bundle fails to build", async () => {
    const root = project({ "app.tsx": `export default () => <p>{</p>;` });

    await expect(launch(root)).rejects.toThrow();
    expect(existsSync(join(root, "dist", ".prerender"))).toBe(false);
  });
});

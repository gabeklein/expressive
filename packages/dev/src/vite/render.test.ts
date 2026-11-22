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

  it("will render pages beside a root remote and return null for one whose render calls it", async () => {
    const root = project({
      "app/remote.ts": `
        import { Model } from "@expressive/mvc";
        export async function user() { return "ada"; }
        export async function slugs() { return ["a"]; }
        export default class Site extends Model { visits = 0; async visit() {} }
      `,
      "app/index.tsx": `
        import { Component, get } from "@expressive/mvc";
        import Site from "./remote";
        export class Page extends Component { site = get(Site); render() { return <button onClick={() => this.site.visit()}>home</button>; } }
      `,
      "app/(account).tsx": `
        import { Component, set } from "@expressive/mvc";
        import { user } from "./remote";
        export class Page extends Component { name = set(() => user()); render() { return <p>{this.name}</p>; } }
      `,
      "app/(caught).tsx": `
        import { Component, set } from "@expressive/mvc";
        import { user } from "./remote";
        export class Page extends Component { name = set(() => user()); catch() {} render() { return <p>{this.name}</p>; } }
      `,
      "app/(later).tsx": `
        import { Component } from "@expressive/mvc";
        import { user } from "./remote";
        export class Page extends Component { new() { user(); } render() { return <p>later</p>; } }
      `,
      "app/(stats).tsx": `
        import { Component, get } from "@expressive/mvc";
        import Site from "./remote";
        export class Page extends Component { site = get(Site); render() { return <p>{this.site.visits}</p>; } }
      `,
      "app/(snapshot).tsx": `
        import { Component, get } from "@expressive/mvc";
        import Site from "./remote";
        export class Page extends Component { site = get(Site); render() { return <p>{this.site.get("visits")}</p>; } }
      `,
      "app/(timer).tsx": `
        import { Component } from "@expressive/mvc";
        import { user } from "./remote";
        export class Page extends Component { new() { setTimeout(() => user(), 10); } render() { return <p>timer</p>; } }
      `,
      "app/(broke).tsx": `export const Page = () => { throw new Error("broke"); };`,
      "app/blog/[slug].tsx": `
        import { slugs } from "../remote";
        export const Page = () => <p>post</p>;
        export const paths = () => slugs();
      `,
    });
    const renderer = await launch(root);

    expect(await renderer.paths()).toEqual([]);
    expect((await renderer.render("/"))?.html).toContain("home</button>");
    expect(await renderer.render("/account")).toBeNull();
    expect(await renderer.render("/caught")).toBeNull();
    expect(await renderer.render("/later")).toBeNull();
    expect(await renderer.render("/stats")).toBeNull();
    expect(await renderer.render("/snapshot")).toBeNull();
    expect((await renderer.render("/timer"))?.html).toContain("<p>timer</p>");
    await expect(renderer.render("/broke")).rejects.toThrow("broke");
    await new Promise(resolve => setTimeout(resolve, 20));
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

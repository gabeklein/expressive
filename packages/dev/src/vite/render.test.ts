import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { launch, type Page } from "./render";

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
    expect((await renderer.render("/blog/b") as Page).html).toContain("<h3>b</h3>");

    const about = await renderer.render("/about") as Page;

    expect(about).toMatchObject({ path: "/about", head: "<title>Site</title>" });
    expect(about.css).toMatch(/^\.Layout-\w+\{color: teal;\}$/);
    expect(about.html).toMatch(/<main class="Layout-\w+">.*<h2>about<\/h2>.*<\/main>/);
    expect(about.html).not.toContain("<h1>");

    renderer.close();
    expect(existsSync(join(root, "dist", ".prerender"))).toBe(false);
  });

  it("will report where a page redirects", async () => {
    const root = project({
      "app/index.tsx": `export const Page = () => <p>home</p>;`,
      "app/(old).tsx": `import { Redirect } from "@expressive/dev"; export const Page = () => { throw new Redirect("/"); };`,
    });
    const renderer = await launch(root);

    expect(await renderer.render("/old")).toMatchObject({ path: "/" });
    expect(await renderer.render("/")).toMatchObject({ path: "/" });
    renderer.close();
  });

  it("will report decisions from self-gating defaults and pages, apart from a path no route matches", async () => {
    const gate = (error: string) => `
      import { NotFound, Redirect } from "@expressive/dev";
      import { Model } from "@expressive/mvc";
      export default class Gate extends Model { new() { throw ${error}; } }
      export const Page = () => <p>gated</p>;
    `;
    const root = project({
      "app/index.tsx": `export const Page = () => <p>home</p>;`,
      "app/(signin).tsx": `export const Page = () => <p>signin</p>;`,
      "app/(old).tsx": gate(`new Redirect("/signin")`),
      "app/(away).tsx": gate(`new Redirect("https://auth.example.com/login")`),
      "app/(gone).tsx": gate("new NotFound()"),
      "app/(leave).tsx": `import { Redirect } from "@expressive/dev"; export const Page = () => { throw new Redirect("https://auth.example.com/login"); };`,
      "app/(lost).tsx": `import { NotFound } from "@expressive/dev"; export const Page = () => { throw new NotFound(); };`,
    });
    const renderer = await launch(root);

    expect(await renderer.render("/old")).toMatchObject({ path: "/signin" });
    expect(await renderer.render("/away")).toBe("decided");
    expect(await renderer.render("/gone")).toBe("decided");
    expect(await renderer.render("/leave")).toBe("decided");
    expect(await renderer.render("/lost")).toBe("decided");
    expect(await renderer.render("/typo")).toBe("unmatched");
    renderer.close();
  });

  it("will render pages beside api/ calls and return null for one whose render or route default calls them", async () => {
    const root = project({
      "api/(user).ts": `
        export async function user() { return "ada"; }
        export async function slugs() { return ["a"]; }
      `,
      "app/index.tsx": `
        import { Component } from "@expressive/mvc";
        import { user } from "../api/(user)";
        export class Page extends Component { render() { return <button onClick={() => user()}>home</button>; } }
      `,
      "app/(account).tsx": `
        import { Component, set } from "@expressive/mvc";
        import { user } from "../api/(user)";
        export class Page extends Component { name = set(() => user()); render() { return <p>{this.name}</p>; } }
      `,
      "app/(caught).tsx": `
        import { Component, set } from "@expressive/mvc";
        import { user } from "../api/(user)";
        export class Page extends Component { name = set(() => user()); catch() {} render() { return <p>{this.name}</p>; } }
      `,
      "app/(later).tsx": `
        import { Component } from "@expressive/mvc";
        import { user } from "../api/(user)";
        export class Page extends Component { new() { user(); } render() { return <p>later</p>; } }
      `,
      "app/(timer).tsx": `
        import { Component } from "@expressive/mvc";
        import { user } from "../api/(user)";
        export class Page extends Component { new() { setTimeout(() => user(), 10); } render() { return <p>timer</p>; } }
      `,
      "app/(guarded).tsx": `
        import { Model } from "@expressive/mvc";
        import { user } from "../api/(user)";
        export default class Guard extends Model { protected async new() { await user(); } }
        export const Page = () => <p>guarded</p>;
      `,
      "app/(broke).tsx": `export const Page = () => { throw new Error("broke"); };`,
      "app/blog/[slug].tsx": `
        import { slugs } from "../../api/(user)";
        export const Page = () => <p>post</p>;
        export const paths = () => slugs();
      `,
    });
    const renderer = await launch(root);

    expect(await renderer.paths()).toEqual([]);
    expect((await renderer.render("/") as Page).html).toContain("home</button>");
    expect(await renderer.render("/account")).toBeNull();
    expect(await renderer.render("/caught")).toBeNull();
    expect(await renderer.render("/later")).toBeNull();
    expect((await renderer.render("/timer") as Page).html).toContain("<p>timer</p>");
    expect(await renderer.render("/guarded")).toBeNull();
    await expect(renderer.render("/broke")).rejects.toThrow("broke");
    await new Promise(resolve => setTimeout(resolve, 20));
    renderer.close();
  });

  it("will render a page importing an api/ route's calls, and return null for one whose render calls them", async () => {
    const root = project({
      "api/(account).ts": `
        export const GET = () => "verb";
        export class Taken extends Error {}
        export async function user() { return "ada"; }
      `,
      "app/index.tsx": `
        import { Component } from "@expressive/mvc";
        import { user, Taken } from "../api/(account)";
        export class Page extends Component { render() { return <button onClick={() => user()}>{Taken.name}</button>; } }
      `,
      "app/(account).tsx": `
        import { Component, set } from "@expressive/mvc";
        import { user } from "../api/(account)";
        export class Page extends Component { name = set(() => user()); render() { return <p>{this.name}</p>; } }
      `,
    });
    const renderer = await launch(root);

    expect((await renderer.render("/") as Page).html).toContain("Taken</button>");
    expect(await renderer.render("/account")).toBeNull();
    renderer.close();
  });

  it("will reject a page whose root default fails its async new()", async () => {
    const root = project({
      "app/index.tsx": `
        import { Model } from "@expressive/mvc";
        export default class Session extends Model { async new() { throw new Error("no session"); } }
        export const Page = () => <p>home</p>;
      `,
    });
    const renderer = await launch(root);

    await expect(renderer.render("/")).rejects.toThrow("no session");
    renderer.close();
  });

  it("will render a ready default class on the server", async () => {
    const renderer = await launch(project({
      "app/index.tsx": `import { Model } from "@expressive/mvc"; export default class Session extends Model { name = "ready"; } export const Page = () => <p>{Session.get().name}</p>;`,
    }));
    expect((await renderer.render("/") as Page).html).toContain("<p>ready</p>");
    renderer.close();
  });

  it("will fail before rendering when a default rejects from async new()", async () => {
    const root = project({
      "app/index.tsx": `export const Page = () => <p>index</p>;`,
      "app/home/index.tsx": `
        import { Model } from "@expressive/mvc";
        export default class Session extends Model {
          async new() {
            await new Promise(resolve => (globalThis.failLate = resolve));
            throw new Error("guard failed");
          }
        }
        export const Page = () => <p>home</p>;
      `,
      "app/(about).tsx": `export const Page = () => <p>about</p>;`,
    });
    const renderer = await launch(root);

    const pending = renderer.render("/home");
    await vi.waitFor(() => expect((globalThis as any).failLate).toBeTypeOf("function"));
    (globalThis as any).failLate();
    await expect(pending).rejects.toThrow("guard failed");
    expect((await renderer.render("/about") as Page).html).toContain("<p>about</p>");

    renderer.close();
    delete (globalThis as any).failLate;
  });

  it("will render a single-file app and list no paths", async () => {
    const renderer = await launch(project({ "app.tsx": `export default () => <p>solo</p>;` }));

    expect(await renderer.paths()).toEqual([]);
    expect((await renderer.render("/") as Page).html).toContain("<p>solo</p>");
    renderer.close();
  });

  it("will clean up if the bundle fails to build", async () => {
    const root = project({ "app.tsx": `export default () => <p>{</p>;` });

    await expect(launch(root)).rejects.toThrow();
    expect(existsSync(join(root, "dist", ".prerender"))).toBe(false);
  });
});

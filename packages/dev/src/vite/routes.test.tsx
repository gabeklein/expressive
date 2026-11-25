// @vitest-environment happy-dom
// @vitest-environment-options { "url": "http://localhost/" }

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { Component, Model } from "@expressive/mvc";
import { Link, Redirect } from "@expressive/router";

import { browserRouter, location, mount, settle } from "../../test.setup";
import { Route } from "../client";
import { generateRoutes, pagePatterns, remoteOf, staticPaths } from "./routes";
import { scanExports } from "./scan";

describe("app/ routing (codegen)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  /** Build a temp `app/` tree, generate its router module, and drop the empty boundaries most tests don't assert. */
  async function generate(files: Record<string, string>): Promise<string> {
    return (await generateRaw(files)).replaceAll(" fallback={null}", "");
  }

  function generateRaw(files: Record<string, string>): Promise<string> {
    const root = mkdtempSync(join(tmpdir(), "routes-"));
    dirs.push(root);

    const appDir = join(root, "app");
    for (const [path, src] of Object.entries(files)) {
      const full = join(appDir, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, src);
    }

    return generateRoutes(appDir, join(root, "out"), scanExports);
  }

  it("will list the static pages for a build to render ahead", async () => {
    const root = mkdtempSync(join(tmpdir(), "routes-"));
    dirs.push(root);

    const appDir = join(root, "app");
    const files = {
      "index.tsx": PAGE,
      "(about).tsx": PAGE,
      "(helper).tsx": "export const x = 1;",
      "docs/index.tsx": PAGE,
      "docs/(intro).tsx": PAGE,
      "docs/guide/(setup).tsx": PAGE,
      "blog/[slug].tsx": PAGE + "; export const paths = () => [];",
      "blog/[slug]/(edit).tsx": PAGE + "; export const paths = () => [];",
      "files/[...].tsx": PAGE,
      "(paths).tsx": PAGE + "; export const paths = () => [];",
      "tally/[id].tsx": PAGE + "; export const paths = () => [];",
      "tally/index.tsx": PAGE,
      "tally/(sub).tsx": PAGE,
      "tally/remote.ts": "export async function add() {}",
      "shop/index.tsx": PAGE,
      "shop/cart/index.tsx": PAGE,
      "shop/remote/index.ts": SCOPE,
      "vault/index.tsx": PAGE,
      "vault/[id].tsx": PAGE + "; export const paths = () => [];",
      "vault/remote.ts": "export default () => {}",
    };

    for (const [path, src] of Object.entries(files)) {
      mkdirSync(dirname(join(appDir, path)), { recursive: true });
      writeFileSync(join(appDir, path), src);
    }

    const { paths, sources } = await staticPaths(appDir, scanExports);

    expect(paths.sort()).toEqual(["/", "/about", "/docs", "/docs/guide/setup", "/docs/intro", "/paths", "/shop", "/shop/cart", "/tally", "/tally/sub"]);
    expect(sources.map(file => relative(appDir, file)).sort()).toEqual(["blog/[slug].tsx", "blog/[slug]/(edit).tsx", "tally/[id].tsx"]);
    expect((await pagePatterns(appDir, scanExports)).sort()).toEqual([
      "/", "/about", "/blog/:slug", "/blog/:slug/edit", "/docs", "/docs/guide/setup", "/docs/intro",
      "/files/*", "/paths", "/shop", "/shop/cart", "/tally", "/tally/:id", "/tally/sub", "/vault", "/vault/:id",
    ]);
  });


  const PAGE = "export function Page(){ return null }";
  const LAYOUT = "export function Layout({ children }){ return children }";
  const LOADING = "export function Loading(){ return null }";
  const CATCH = "export function Catch(){ return null }";
  const NOTFOUND = "export function NotFound(){ return null }";
  const ENTER = "export default () => '/login'";
  const SCOPE = "export default class Session extends Model {}";

  it("root is always a scope; lone index becomes the \"/\" page + implicit 404", async () => {
    const out = await generate({ "index.tsx": PAGE });
    expect(out).toContain('import { NotFound, Route, Router } from "@expressive/dev";');
    expect(out).toContain('import { Page as Root } from "../app/index.tsx";');
    expect(out).toMatch(/<Route>\s*<Route as={Root} \/>\s*<Route none as={NotFound} \/>\s*<\/Route>/);
  });

  it("a user NotFound suppresses the implicit 404 (no NotFound import)", async () => {
    const out = await generate({ "index.tsx": `${PAGE}\n${NOTFOUND}` });
    expect(out).toContain('import { Route, Router } from "@expressive/dev";');
    expect(out).not.toContain("{ NotFound, Route, Router }");
    expect(out).toContain("<Route none as={RootNotFound} />");
  });

  it("Layout makes a scope; index page is a to-less child; NotFound is its last child", async () => {
    const out = await generate({ "index.tsx": `${PAGE}\n${LAYOUT}\n${NOTFOUND}` });
    expect(out).toContain("import { Page as Root, Layout as RootLayout, NotFound as RootNotFound }");
    expect(out).toMatch(/<Route as={RootLayout}>\s*<Route as={Root} \/>\s*<Route none as={RootNotFound} \/>/);
  });

  it("Loading fills its scope's slot; Catch rides on the scope", async () => {
    const out = await generate({ "index.tsx": `${PAGE}\n${LOADING}\n${CATCH}` });
    expect(out).toContain("{ Page as Root, Loading as RootLoading, Catch as RootCatch }");
    expect(out).toMatch(/<Route Catch={RootCatch}>\s*<Route as={Root} fallback={<RootLoading \/>} \/>/);
  });

  it("every route owns a boundary - empty where no Loading applies", async () => {
    const out = await generateRaw({ "index.tsx": PAGE, "(about).tsx": PAGE });
    expect(out).toContain("<Route fallback={null}>");
    expect(out).toContain("<Route none as={NotFound} fallback={null} />");
    expect(out).toContain("<Route as={Root} fallback={null} />");
    expect(out).toContain('<Route to="about" as={About} fallback={null} />');
  });

  it("Loading covers each route in its Layout's slot, at any depth, but not the Layout", async () => {
    const out = await generateRaw({
      "index.tsx": PAGE,
      "projects/index.tsx": `${PAGE}\n${LAYOUT}\n${LOADING}`,
      "projects/[id].tsx": PAGE,
      "projects/archive/index.tsx": PAGE,
      "projects/archive/[year].tsx": PAGE,
    });
    expect(out).toContain('<Route to="projects" as={ProjectsLayout} fallback={null}>');
    expect(out).toContain("<Route as={Projects} fallback={<ProjectsLoading />} />");
    expect(out).toContain('<Route to=":id" as={ProjectsId} fallback={<ProjectsLoading />} />');
    expect(out).toContain('<Route to="archive" as={Through} fallback={<ProjectsLoading />}>');
    expect(out).toContain("const Through = props => props.children;");
    expect(out).toContain('<Route to=":year" as={ProjectsArchiveYear} fallback={<ProjectsLoading />} />');
  });

  it("a nested Layout starts a fresh slot", async () => {
    const out = await generateRaw({
      "index.tsx": `${PAGE}\n${LOADING}`,
      "settings/index.tsx": `${PAGE}\n${LAYOUT}`,
      "settings/[tab].tsx": PAGE,
    });
    expect(out).toContain('<Route to="settings" as={SettingsLayout} fallback={<RootLoading />}>');
    expect(out).toContain('<Route to=":tab" as={SettingsTab} fallback={null} />');
  });

  it("a page's own Loading covers it before its slot's", async () => {
    const out = await generateRaw({ "index.tsx": `${PAGE}\n${LOADING}`, "(about).tsx": `${PAGE}\n${LOADING}` });
    expect(out).toContain('<Route to="about" as={About} fallback={<AboutLoading />} />');
  });

  it("(about) is a static leaf → to=\"about\", loaded on demand", async () => {
    const out = await generate({ "index.tsx": PAGE, "(about).tsx": PAGE });
    expect(out).toContain('const About = () => import("../app/(about).tsx").then(m => m.Page);');
    expect(out).toContain('<Route to="about" as={About} />');
    expect(out).toContain('import { Page as Root } from "../app/index.tsx";');
  });

  it("will leave a remote module out of the tree, its default class or not", async () => {
    const out = await generate({ "index.tsx": PAGE, "tally/index.tsx": PAGE, "tally/remote.ts": SCOPE, "remote.ts": "export async function add() {}" });

    expect(out).not.toContain("remote");
    expect(out).toContain('<Route to="tally" as={Tally} />');
  });

  it("will not route a remote/ folder", async () => {
    const out = await generate({ "index.tsx": PAGE, "remote/index.ts": PAGE, "remote/bar.ts": PAGE });
    expect(out).not.toContain("remote");
  });

  it("will throw if a folder has both a remote module and a remote/ folder", async () => {
    await expect(generate({ "index.tsx": PAGE, "remote.ts": "", "remote/bar.ts": "" })).rejects.toThrow("has both a remote module and a remote/ folder - pick one.");
  });

  it("a module exporting Loading or Catch is imported statically", async () => {
    const out = await generate({ "index.tsx": PAGE, "(about).tsx": `${PAGE}\n${LOADING}`, "(help).tsx": `${PAGE}\n${CATCH}` });
    expect(out).toContain('import { Page as About, Loading as AboutLoading } from "../app/(about).tsx";');
    expect(out).toContain('import { Page as Help, Catch as HelpCatch } from "../app/(help).tsx";');
    expect(out).not.toContain("import(");
  });

  it("a nested Layout and NotFound load with their page", async () => {
    const out = await generate({ "index.tsx": PAGE, "blog/index.tsx": `${PAGE}\n${LAYOUT}\n${NOTFOUND}`, "blog/[slug].tsx": PAGE });
    expect(out).toContain('const BlogLayout = () => import("../app/blog/index.tsx").then(m => m.Layout);');
    expect(out).toContain('const BlogNotFound = () => import("../app/blog/index.tsx").then(m => m.NotFound);');
  });

  it("default entry hook rides as the `enter` prop on a leaf", async () => {
    const out = await generate({ "index.tsx": PAGE, "(admin).tsx": `${PAGE}\n${ENTER}` });
    expect(out).toContain('const AdminEnter = () => import("../app/(admin).tsx").then(m => m.default);');
    expect(out).toContain('<Route to="admin" as={Admin} enter={AdminEnter} />');
  });

  it("default entry hook gates a section (rides on the scope)", async () => {
    const out = await generate({ "admin/index.tsx": `${PAGE}\n${LAYOUT}\n${ENTER}`, "admin/[id].tsx": PAGE });
    expect(out).toContain('const AdminEnter = () => import("../app/admin/index.tsx").then(m => m.default);');
    expect(out).toMatch(/<Route to="admin" as={AdminLayout} enter={AdminEnter}>/);
  });

  it("will place a folder's NotFound as its last child, and none beside a [...] page, with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await generate({
      "index.tsx": PAGE,
      "[slug].tsx": PAGE,
      "docs/index.tsx": `${PAGE}\n${NOTFOUND}`,
      "help/index.tsx": `${PAGE}\n${NOTFOUND}`,
      "help/[...].tsx": PAGE,
    });

    expect(out).toMatch(/<Route to="docs" as={Through}>\s*<Route as={Docs} \/>\s*<Route none as={DocsNotFound} \/>\s*<\/Route>/);
    expect(out).toMatch(/<Route to="help" as={Through}>\s*<Route as={Help} \/>\s*<Route to="\*" as={HelpCatchall} \/>\s*<\/Route>/);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("help/index.tsx: NotFound is never shown"));
    warn.mockRestore();
  });

  it("will wrap a gated folder's entry in the gate check, loading its module beside it", async () => {
    const GATE = "export default () => {}";
    const out = await generate({
      "index.tsx": PAGE,
      "admin/index.tsx": `${PAGE}\n${ENTER}`,
      "admin/remote.ts": GATE,
      "admin/users/index.tsx": PAGE,
      "admin/users/remote/index.ts": GATE,
      "shop/[id]/index.tsx": `${PAGE}\n${LOADING}`,
      "shop/[id]/remote.ts": GATE,
      "tally/index.tsx": PAGE,
      "tally/remote.ts": "export async function add() {}",
      "notes/index.tsx": PAGE,
      "notes/remote": "",
    });

    expect(out).toContain('import { gateCheck, NotFound, Route, Router } from "@expressive/dev";');
    expect(out).toContain('import { call } from "@expressive/rpc";');
    expect(out).toContain('const checked = gateCheck(call, {"page":1,"none":1,"in":[{"to":"admin","gate":1,"page":1,"in":[{"to":"users","gate":1,"page":1,"in":[]}]},{"to":"notes","page":1,"in":[]},{"to":"shop","in":[{"to":":id","gate":1,"page":1,"in":[]}]},{"to":"tally","page":1,"in":[]}]}, import.meta.hot);');
    expect(out).toContain('<Route to="admin" enter={checked(AdminEnter, () => import("../app/admin/index.tsx"))}>');
    expect(out).toContain('<Route to="users" as={AdminUsers} enter={checked(undefined, () => import("../app/admin/users/index.tsx"))} />');
    expect(out).toContain('<Route to=":id" as={ShopId} enter={checked()} fallback={<ShopIdLoading />} />');
    expect(out).toContain('<Route to="tally" as={Tally} />');
  });

  it("will gate the root and skip gated folders when rendering ahead", async () => {
    const out = await generate({ "index.tsx": PAGE, "remote.ts": "export default () => {}" });

    expect(out).toContain('<Route enter={checked()}>');
  });

  it("a module with a default loads on first entry", async () => {
    const out = await generate({ "index.tsx": PAGE, "(account).tsx": `${PAGE}\n${SCOPE}` });
    expect(out).toContain('const AccountScope = () => import("../app/(account).tsx").then(m => props => wrap(m.default, props.children));');
    expect(out).toContain('const Account = () => import("../app/(account).tsx").then(m => m.Page);');
  });

  it("the root's default stays a static import", async () => {
    const out = await generate({ "index.tsx": `${PAGE}\n${ENTER}` });
    expect(out).toContain('import RootEnter, { Page as Root } from "../app/index.tsx";');
  });

  it("a default class renders around the route's content", async () => {
    const out = await generate({ "index.tsx": PAGE, "account/index.tsx": `${PAGE}\n${SCOPE}`, "account/[id].tsx": PAGE });
    expect(out).toMatch(/<Route to="account" as={AccountScope}>\s*<Route as={Account} \/>/);
    expect(out).not.toContain("enter={AccountScope}");
  });

  it("a default class wraps the Layout", async () => {
    const out = await generate({ "index.tsx": PAGE, "account/index.tsx": `${PAGE}\n${LAYOUT}\n${SCOPE}` });
    expect(out).toContain("const AccountScoped = props => <AccountScope><AccountLayout {...props} /></AccountScope>;");
    expect(out).toMatch(/<Route to="account" as={AccountScoped}>/);
  });

  it("will declare nested wrappers innermost first, and none for a scope with nothing to render", async () => {
    const out = await generate({
      "index.tsx": `${PAGE}\n${LAYOUT}\n${SCOPE}`,
      "account/index.tsx": `${PAGE}\n${LAYOUT}\n${SCOPE}`,
      "account/settings/index.tsx": `${PAGE}\n${LAYOUT}\n${SCOPE}`,
      "void/index.tsx": `${LAYOUT}\n${SCOPE}`,
    });
    const wrappers = out.split("\n").filter(line => line.includes(" = props =>")).map(line => line.split(" ")[1]);

    expect(wrappers).toEqual(["AccountSettingsScoped", "AccountScoped", "RootScoped"]);
  });

  it("a default class makes a lone page a scope", async () => {
    const out = await generate({ "index.tsx": PAGE, "(settings).tsx": `${PAGE}\nclass Panel extends Model {}\nexport { Panel as default }` });
    expect(out).toMatch(/<Route to="settings" as={SettingsScope}>\s*<Route as={Settings} \/>/);
  });

  it("will read a class exported as the default by name as a scope, not an entry hook", async () => {
    const out = await generate({ "index.tsx": PAGE, "(settings).tsx": `${PAGE}\nexport class Panel extends Model {}\nexport default Panel;` });
    expect(out).toMatch(/<Route to="settings" as={SettingsScope}>\s*<Route as={Settings} \/>/);
    expect(out).not.toContain("SettingsEnter");
  });

  it("will read a function exported as the default by name as an entry hook", async () => {
    const out = await generate({ "index.tsx": PAGE, "(admin).tsx": `${PAGE}\nconst gate = () => "/login";\nexport default gate` });
    expect(out).toContain('<Route to="admin" as={Admin} enter={AdminEnter} />');
  });

  it("[slug] is a dynamic segment → to=\":slug\"", async () => {
    const out = await generate({ "blog/index.tsx": PAGE, "blog/[slug].tsx": PAGE });
    expect(out).toContain('<Route to="blog">');
    expect(out).toContain('<Route to=":slug" as={BlogSlug} />');
  });

  it("[...] is a catch-all → to=\"*\"", async () => {
    const out = await generate({ "docs/[...].tsx": PAGE });
    expect(out).toContain('<Route to="*" as={DocsCatchall} />');
  });

  it("will declare static segments before params, and params before a catch-all", async () => {
    const out = await generate({ "index.tsx": PAGE, "[...].tsx": PAGE, "[id]/index.tsx": PAGE, "gallery/index.tsx": PAGE, "(about).tsx": PAGE });
    const order = ['to="about"', 'to="gallery"', 'to=":id"', 'to="*"'].map(to => out.indexOf(to));

    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order[0]).toBeGreaterThan(-1);
  });

  it("bare-named files are support modules, ignored", async () => {
    const out = await generate({ "index.tsx": PAGE, "Logo.tsx": PAGE, "blog/index.tsx": PAGE, "blog/Card.tsx": PAGE });
    expect(out).not.toContain("Logo");
    expect(out).not.toContain("Card");
  });

  it("childless page folder collapses to a self-closing leaf", async () => {
    const out = await generate({ "index.tsx": PAGE, "blog/index.tsx": PAGE });
    expect(out).toContain('<Route to="blog" as={Blog} />');
    expect(out).not.toContain('<Route to="blog">');
  });

  it("folder with index + child nests the index as a bare child", async () => {
    const out = await generate({ "blog/index.tsx": PAGE, "blog/[slug].tsx": PAGE });
    expect(out).toMatch(/<Route to="blog">\s*<Route as={Blog} \/>/);
  });

  it("emits Route directly - no per-node subclasses", async () => {
    const out = await generate({ "index.tsx": `${PAGE}\n${LAYOUT}`, "blog/index.tsx": PAGE, "blog/[slug].tsx": PAGE });
    expect(out).not.toContain("extends Route");
    expect(out).not.toMatch(/class \w+Route/);
  });

  it("scans exports through TypeScript and JSX", async () => {
    const out = await generate({
      "index.tsx": `import { Route, Router } from "@expressive/dev";
        type Props = { n: number };
        export class Page extends Route { render() { return <h1>{this.match?.x satisfies string | undefined}</h1>; } }
        export const Layout = (p: Props) => <div>{p.n}</div>;
        export default async function (route: Route): Promise<string | void> {}`,
    });
    expect(out).toContain("import RootEnter, { Page as Root, Layout as RootLayout }");
  });

  it("will ignore files that are not modules", async () => {
    expect(await generate({ "index.tsx": PAGE, "notes.md": "# notes" })).not.toContain("notes");
  });

  it("will suffix an alias another route already took", async () => {
    const out = await generate({ "index.tsx": PAGE, "a/index.tsx": `${PAGE}\n${LAYOUT}`, "a/layout/index.tsx": PAGE });
    expect(out).toContain('const ALayout = () => import("../app/a/index.tsx").then(m => m.Layout);');
    expect(out).toContain('const ALayout_ = () => import("../app/a/layout/index.tsx").then(m => m.Page);');
  });

  it("will import a lone default and provide it around the children", async () => {
    const out = await generate({ "index.tsx": SCOPE, "a/index.tsx": PAGE });
    expect(out).toContain('import RootScope from "../app/index.tsx";');
    expect(out).toContain("const RootScoped = props => wrap(RootScope, props.children);");
    expect(out).not.toContain("const hook =");
  });

  it("will leave a default it cannot see declared to tell itself apart at runtime", async () => {
    const IMPORTED = `import { Auth } from "../lib/auth";\nexport default Auth;`;
    const out = await generate({ "index.tsx": `${PAGE}\n${IMPORTED}`, "(x).tsx": `${PAGE}\nexport { default } from "../lib/auth";` });

    expect(out).toContain('import { Component, Model } from "@expressive/mvc";');
    expect(out).toContain('const RootEnter = hook(RootScope, "app/index.tsx");');
    expect(out).toContain('const XEnter = () => import("../app/(x).tsx").then(m => hook(m.default, "app/(x).tsx"));');
    expect(out).toMatch(/<Route as={RootScoped} enter={RootEnter}>/);
    expect(out).toMatch(/<Route to="x" as={XScope} enter={XEnter}>\s*<Route as={X} \/>/);
  });

  it("will not route a leaf without a page", async () => {
    expect(await generate({ "index.tsx": PAGE, "go/index.tsx": ENTER })).not.toContain('to="go"');
  });

  it("will mount the root's Router export in place of dev's", async () => {
    const out = await generate({ "index.tsx": "export class Router {}", "(a).tsx": PAGE, "_/index.tsx": `${PAGE}\nexport class Router {}` });
    expect(out).toContain('import { NotFound, Route } from "@expressive/dev";');
    expect(out).toContain('import { Router } from "../app/index.tsx";');
    expect(out).toContain('import { Page as Root } from "../app/_/index.tsx";');
    expect(out).toContain("<Router {...props}>");
  });

  it("will label a route by its module's label", async () => {
    const out = await generate({
      "index.tsx": `${PAGE}\nexport const label = "Home";`,
      "me/index.tsx": `${PAGE}\nexport const label = 'Me';`,
      "me/(edit).tsx": PAGE,
      "(new).tsx": `${PAGE}\nexport const label = "New \\"one\\"";`,
      "you/index.tsx": `${PAGE}\nconst named = "You"; export { named as label };`,
    });
    expect(out).toContain('<Route label={"Home"}>');
    expect(out).toContain('<Route to="me" label={"Me"}>');
    expect(out).toContain('<Route to="new" label={"New \\"one\\""} as={New} />');
    expect(out).toContain('<Route to="edit" as={MeEdit} />');
    expect(out).toContain('<Route to="you" label={"You"} as={You} />');
  });

  it("will throw if a label is not a string literal", async () => {
    for (const label of [
      "export const label = name;",
      "export const { label } = names;",
      "let label = 'A'; label = 'B'; export { label };",
      "// export const label = 'Old';\nexport const label = name;",
    ])
      await expect(generate({ "index.tsx": `${PAGE}\n${label}` }))
        .rejects.toThrow(/not a string literal/);
  });

  it("module always exports a default App component, host-neutral", async () => {
    const out = await generate({ "index.tsx": PAGE });
    expect(out).toContain("const App = (props) => (");
    expect(out).toContain("export default App;");
    expect(out).not.toContain("@expressive/router");
    expect(out).not.toContain("@expressive/react");
    expect(out).not.toContain("@expressive/dom");
  });
});

// Mirrors the generator's emit: every node is a `Route` element directly, mounted on @expressive/dom.
describe("app/ routing (runtime)", () => {
  browserRouter();

  const RootLayout = (props: { children?: any }) => <div data-root>{props.children}</div>;
  const Home = () => <h1>home</h1>;
  const BlogIndex = () => <p>blog-index</p>;
  const BlogPost = () => {
    const { match } = Route.get();
    return <article>post:{match!.slug}</article>;
  };
  const NotFound = () => <p>not-found</p>;

  const Tree = () => (
    <Route as={RootLayout} NotFound={NotFound}>
      <Route as={Home} />
      <Route to="blog">
        <Route as={BlogIndex} />
        <Route to=":slug" as={BlogPost} />
      </Route>
    </Route>
  );

  const rootText = async () => (await mount(Tree)).querySelector("[data-root]")?.textContent;

  it("/ → RootLayout > Home", async () => {
    location("/");
    expect(await rootText()).toBe("home");
  });

  it("/blog → RootLayout > BlogIndex", async () => {
    location("/blog");
    expect(await rootText()).toBe("blog-index");
  });

  it("/blog/:slug → nested scope resolves", async () => {
    location("/blog/hello");
    expect(await rootText()).toBe("post:hello");
  });

  it("/nope → NotFound", async () => {
    location("/nope");
    expect(await rootText()).toBe("not-found");
  });

  describe("a folder's NotFound", () => {
    const Through = (props: { children?: any }) => props.children;
    const Missing = () => <p>docs-missing</p>;
    const DocsLayout = (props: { children?: any }) => <section>docs:{props.children}</section>;
    const Slug = () => <p>slug:{Route.get().match!.slug}</p>;
    const Rest = () => <p>rest:{Route.get().match!["*"]}</p>;
    const text = async (Tree: () => any) => (await mount(Tree)).querySelector("[data-root]")?.textContent;

    it("will show under a pass-through folder beside a param page", async () => {
      const Tree = () => (
        <Route as={RootLayout}>
          <Route to="docs" as={Through}>
            <Route as={BlogIndex} />
            <Route none as={Missing} fallback={null} />
          </Route>
          <Route to=":slug" as={Slug} />
          <Route none as={NotFound} fallback={null} />
        </Route>
      );

      location("/docs/missing");
      expect(await text(Tree)).toBe("docs-missing");
      document.body.replaceChildren();
      location("/hello");
      expect(await text(Tree)).toBe("slug:hello");
    });

    it("will show under a Layout beside a sibling page", async () => {
      const Tree = () => (
        <Route as={RootLayout}>
          <Route to="about" as={Home} />
          <Route to="docs" as={DocsLayout}>
            <Route as={BlogIndex} />
            <Route none as={Missing} fallback={null} />
          </Route>
          <Route none as={NotFound} fallback={null} />
        </Route>
      );

      location("/docs/missing");
      expect(await text(Tree)).toBe("docs:docs-missing");
    });

    it("will leave a folder's paths to its [...] page, and the rest to a [...] beside it", async () => {
      const Tree = () => (
        <Route as={RootLayout}>
          <Route to="docs" as={Through}>
            <Route as={BlogIndex} />
            <Route to="*" as={Rest} />
          </Route>
          <Route to="help" as={Through}>
            <Route as={BlogIndex} />
            <Route none as={Missing} fallback={null} />
          </Route>
          <Route to="*" as={Rest} />
        </Route>
      );

      location("/docs/a/b");
      expect(await text(Tree)).toBe("rest:a/b");
      document.body.replaceChildren();
      location("/help/x");
      expect(await text(Tree)).toBe("docs-missing");
      document.body.replaceChildren();
      location("/else");
      expect(await text(Tree)).toBe("rest:else");
    });
  });

  it("will render the index alone at /, a [...] page beside it below, and a static page over both", async () => {
    const Rest = () => <p>rest:{Route.get().match!["*"]}</p>;
    const Tree = () => (
      <Route as={RootLayout}>
        <Route as={Home} />
        <Route to="about" as={BlogIndex} />
        <Route to="*" as={Rest} />
      </Route>
    );

    for (const [path, text] of [["/", "home"], ["/x", "rest:x"], ["/about", "blog-index"]]) {
      document.body.replaceChildren();
      location(path);
      expect((await mount(Tree)).querySelector("[data-root]")?.textContent).toBe(text);
    }
  });

  it("will leave a [...] page without rendering it against the next page's path", async () => {
    const Claim = () => (
      <Route>
        <Route to="claim" as={() => <Link to="/report">report</Link>} />
        <Route none as={() => <Redirect to="/claim" />} />
      </Route>
    );
    const Report = () => Promise.resolve(() => <h1>report</h1>);
    const Tree = () => (
      <Route fallback={null}>
        <Route to="report" as={Report} fallback={null} />
        <Route to="*" as={Claim} fallback={null} />
      </Route>
    );

    location("/claim");
    const root = await mount(Tree);

    root.querySelector("a")!.click();
    await settle();
    await settle();

    expect(window.location.pathname).toBe("/report");
    expect(root.textContent).toBe("report");
  });

  it("will hold a folder's page under a Layout reading the path while the next page loads", async () => {
    let load!: (page: () => any) => void;
    const Post = () => new Promise<() => any>(resolve => (load = resolve));
    const Shell = (props: { children?: any }) => <section data-path={Route.get().router.path}>{props.children}<Link to="/blog/x">x</Link></section>;
    const Tree = () => (
      <Route fallback={null}>
        <Route to="blog" as={Shell} fallback={null}>
          <Route as={BlogIndex} fallback={null} />
          <Route to=":slug" as={Post} fallback={null} />
        </Route>
      </Route>
    );

    location("/blog");
    const root = await mount(Tree);

    root.querySelector("a")!.click();
    await settle();
    await settle();

    expect(root.textContent).toBe("blog-indexx");

    load(() => <p>post</p>);
    await vi.waitFor(() => expect(root.textContent).toBe("postx"));
  });

  it("will let a static page shadow a param folder beside it, as the tree passes it through", async () => {
    const Through = (props: { children?: any }) => props.children;
    const Room = () => <p>room:{Route.get().match!.id}</p>;
    const Rooms = () => (
      <Route as={RootLayout}>
        <Route to="room">
          <Route to="new" as={() => <p>new</p>} />
          <Route to=":id" as={Through}>
            <Route as={Room} />
            <Route to="notes" as={() => <p>notes</p>} />
          </Route>
        </Route>
      </Route>
    );

    location("/room/new");
    expect((await mount(Rooms)).querySelector("[data-root]")?.textContent).toBe("new");
  });
});

describe("app/ routing (scope)", () => {
  browserRouter();

  it("provides a default Model to the layout and pages while the route is matched", async () => {
    const lives: string[] = [];

    class Session extends Model {
      user = "ada";
      protected new() {
        lives.push("new");
        return () => lives.push("gone");
      }
    }

    const Shell = (props: { children?: any }) => <div data-shell>{Session.get().user}:{props.children}</div>;
    const Scoped = (props: { children?: any }) => <Component for={Session}><Shell {...props} /></Component>;
    const Account = () => <span>{Session.get().user}</span>;
    const Home = () => <span>home</span>;

    const Tree = () => (
      <Route>
        <Route as={Home} />
        <Route to="account" as={Scoped}>
          <Route as={Account} />
        </Route>
      </Route>
    );

    location("/account");
    const root = await mount(Tree);

    expect(root.querySelector("[data-shell]")?.textContent).toBe("ada:ada");
    expect(lives).toEqual(["new"]);

    window.history.pushState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await settle();

    expect(root.textContent).toBe("home");
    expect(lives).toEqual(["new", "gone"]);
  });

  it("provides a default class loaded on demand", async () => {
    class Session extends Model {
      user = "ada";
    }

    const Scope = () => Promise.resolve({ default: Session }).then(m => (props: { children?: any }) => <Component for={m.default}>{props.children}</Component>);
    const Account = () => <span>{Session.get().user}</span>;

    const Tree = () => (
      <Route>
        <Route to="account" as={Scope} fallback={null}>
          <Route as={Account} fallback={null} />
        </Route>
      </Route>
    );

    location("/account");
    const root = await mount(Tree);
    await settle();
    expect(root.textContent).toBe("ada");
  });

  it("renders a Component default as the layout", async () => {
    class Frame extends Component {
      render(props: { children?: any }) {
        return <section data-frame>{props.children}</section>;
      }
    }

    const Tree = () => (
      <Route>
        <Route to="x" as={Frame}>
          <Route as={() => <span>inside</span>} />
        </Route>
      </Route>
    );

    location("/x");
    const root = await mount(Tree);
    expect(root.querySelector("[data-frame]")?.textContent).toBe("inside");
  });
});

describe("app/ routing (generated)", () => {
  browserRouter();

  const dirs: string[] = [];
  const PRAGMA = "/** @jsxImportSource @expressive/dev */\n";
  const BUILD = join(import.meta.dirname, "../../build");

  beforeAll(() => mkdirSync(BUILD, { recursive: true }));
  afterAll(() => rmSync(BUILD, { recursive: true, force: true }));

  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  async function app(files: Record<string, string>, path: string) {
    const root = mkdtempSync(join(BUILD, "routes-"));
    const appDir = join(root, "app");
    const out = join(root, "out", "routes.tsx");

    dirs.push(root);

    for (const [file, src] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), PRAGMA + src);
    }

    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, PRAGMA + await generateRoutes(appDir, dirname(out), scanExports));

    location(path);

    const { default: App } = await import(/* @vite-ignore */ out);

    return mount(App);
  }

  const shows = (read: () => unknown, expected: string) => vi.waitFor(() => expect(read()).toBe(expected));

  const FRAME = `import { Component } from "@expressive/mvc";
    export class Frame extends Component {
      title = "frame";
      render(props) { return <section>{this.title}:{props.children}</section>; }
    }`;
  const SESSION = `import { Model } from "@expressive/mvc";
    export class Session extends Model { user = "ada"; }`;
  const GUARD = `export const guard = () => "/";`;
  const PAGE = `export const Page = () => <h1>page</h1>;`;
  const USER = `import { Session } from "../lib/session"; export const Page = () => <h1>{Session.get().user}</h1>;`;

  it.each([
    ["at the root", { "app/index.tsx": `import { Frame } from "../lib/frame"; export default Frame; ${PAGE}` }, "/"],
    ["beside a Layout", { "app/index.tsx": `import { Frame } from "../lib/frame"; export default Frame; ${PAGE} export const Layout = props => <main>{props.children}</main>;` }, "/"],
    ["on a lazy folder", { "app/index.tsx": PAGE, "app/x/index.tsx": `import { Frame } from "../../lib/frame"; export default Frame; ${PAGE}` }, "/x"],
    ["on a lazy folder beside a Layout", { "app/index.tsx": PAGE, "app/x/index.tsx": `import { Frame } from "../../lib/frame"; export default Frame; ${PAGE} export const Layout = props => <main>{props.children}</main>;` }, "/x"],
  ])("will render a default Component imported from elsewhere around the page %s", async (_, files, path) => {
    const root = await app({ ...files, "lib/frame.tsx": FRAME }, path);
    await shows(() => root.querySelector("section")?.textContent, "frame:page");
  });

  it("will render a default Component declared in the module around the page", async () => {
    const root = await app({ "app/index.tsx": PAGE, "app/(x).tsx": `${FRAME.replace("export class", "export default class")} ${PAGE}` }, "/x");
    await shows(() => root.querySelector("section")?.textContent, "frame:page");
  });

  it("will provide a default Model imported from elsewhere", async () => {
    const root = await app({ "app/index.tsx": `export { Session as default } from "../lib/session"; ${USER}`, "lib/session.ts": SESSION }, "/");
    await shows(() => root.textContent, "ada");
  });

  it("will run a default function imported from elsewhere as the entry hook", async () => {
    const root = await app({
      "app/index.tsx": PAGE,
      "app/(x).tsx": `import { guard } from "../lib/guard"; export default guard; export const Page = () => <h1>x</h1>;`,
      "lib/guard.ts": GUARD,
    }, "/x");

    await shows(() => root.textContent, "page");
    expect(window.location.pathname).toBe("/");
  });

  it("will throw naming the route for a default imported from elsewhere that is a class but not a Model", async () => {
    await expect(app({ "app/index.tsx": `import { Plain } from "../lib/plain"; export default Plain; ${PAGE}`, "lib/plain.ts": "export class Plain {}" }, "/"))
      .rejects.toThrow("app/index.tsx: the default export Plain is a class but not a Model or Component.");
  });

  it("will render the root index alone at /, and a root [...] page below", async () => {
    const files = { "app/index.tsx": PAGE, "app/[...].tsx": `export const Page = () => <h1>rest</h1>;`, "app/(about).tsx": `export const Page = () => <h1>about</h1>;` };

    for (const [path, text] of [["/", "page"], ["/x", "rest"], ["/about", "about"]]) {
      document.body.replaceChildren();
      const root = await app(files, path);
      await shows(() => root.textContent, text);
    }
  });
});

describe("remote modules", () => {
  const appDir = join(tmpdir(), "app");
  const at = (path: string) => {
    const remote = remoteOf(appDir, join(appDir, path));
    return remote && [remote.pattern, remote.module, remote.folder.slice(appDir.length)];
  };

  it("will find a folder's remote module with its route pattern", () => {
    expect(at("remote.ts")).toEqual([[], "", ""]);
    expect(at("blog/[slug]/remote.ts")).toEqual([["blog", ":slug"], "", "/blog/[slug]"]);
    expect(at("(about)/remote.mts")).toEqual([["about"], "", "/(about)"]);
    expect(at("docs/[...]/remote.js")).toEqual([["docs", "*"], "", "/docs/[...]"]);
  });

  it("will give every module in a remote/ folder its parent's pattern", () => {
    expect(at("blog/remote/index.ts")).toEqual([["blog"], "", "/blog"]);
    expect(at("blog/remote/bar.ts")).toEqual([["blog"], "bar", "/blog"]);
    expect(at("blog/remote/bar/baz.ts")).toEqual([["blog"], "bar/baz", "/blog"]);
    expect(at("blog/remote/bar/index.ts")).toEqual([["blog"], "bar", "/blog"]);
  });

  it("will not take other modules, or files outside app/, as remote", () => {
    expect(at("blog/index.tsx")).toBeUndefined();
    expect(at("blog/remote.spec.ts")).toBeUndefined();
    expect(at("blog/remote/view.tsx")).toBeUndefined();
    expect(remoteOf(appDir, join(tmpdir(), "remote.ts"))).toBeUndefined();
  });
});

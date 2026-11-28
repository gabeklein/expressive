import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Page } from "./render";

const launch = vi.hoisted(() => vi.fn());

vi.mock("./render", () => ({ launch }));

import { fill, prerender } from "./prerender";

const PAGE = "export function Page() { return null }";
const SHELL = `<html><head><title>Shell</title></head><body><div id="root"></div></body></html>`;

const dirs: string[] = [];
let warn: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  launch.mockReset();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function built(files: Record<string, string>, shell = SHELL) {
  const root = mkdtempSync(join(tmpdir(), "prerender-"));
  dirs.push(root);

  for (const [file, source] of Object.entries({ ...files, "dist/client/index.html": shell })) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), source);
  }

  return root;
}

function renderer(render: (path: string) => Partial<Page> | "decided" | "unmatched" | null, listed: string[] = []) {
  const close = vi.fn();

  launch.mockResolvedValueOnce({
    paths: async () => listed,
    render: async (path: string) => {
      const page = render(path);
      return page && (typeof page == "string" ? page : { path, html: path, css: "", head: "", ...page });
    },
    close,
  });

  return { close };
}

describe("prerender", () => {
  it("will write each static page and keep the shell as 200.html", async () => {
    const root = built({ "app/index.tsx": PAGE, "app/(about).tsx": PAGE, "app/docs/(intro).tsx": PAGE, "app/blog/[slug].tsx": PAGE });
    const { close } = renderer(() => ({}), ["/blog/hello/", "/about"]);
    const client = join(root, "dist", "client");
    const page = (path: string) => readFileSync(join(client, path, "index.html"), "utf8");

    expect(await prerender(root)).toEqual(["/", "/about", "/docs/intro", "/blog/hello"]);
    expect(readFileSync(join(client, "200.html"), "utf8")).toBe(SHELL);
    expect(page("blog/hello")).toContain(`<div id="root" data-prerender="/blog/hello">/blog/hello</div>`);
    expect(page("")).toContain(`<div id="root" data-prerender="/">/</div>`);
    expect(page("docs/intro")).toContain(">/docs/intro</div>");
    expect(close).toHaveBeenCalled();
    expect(launch).toHaveBeenCalledWith(root, {});
    expect(log).toHaveBeenCalledWith("Prerendered 4 pages.");
  });

  it("will summarize route decisions and warn for empty, failed or unmatched pages", async () => {
    const root = built({ "app/(a).tsx": PAGE, "app/(b).tsx": PAGE, "app/(c).tsx": PAGE, "app/(d).tsx": PAGE, "app/(e).tsx": PAGE, "app/(f).tsx": PAGE });

    renderer(path => {
      if (path == "/a") return { path: "/" };
      if (path == "/b") return { html: "<!--fragment--> <!--/fragment-->" };
      if (path == "/c") throw new Error("broke");
      if (path == "/d") return "decided";
      if (path == "/e") return null;
      if (path == "/typo") return "unmatched";
      return {};
    }, ["/typo", "relative", "/x/../d", "/q?x=1", "/%E0%A4%A", 7 as any]);

    expect(await prerender(root)).toEqual(["/f"]);
    expect(warn.mock.calls.map(([message]: unknown[]) => message)).toEqual([
      "/b rendered nothing at build - left to the client.",
      "/c was not prerendered: broke",
      "/typo matches no route - not prerendered.",
      "relative is not an absolute path - not prerendered.",
      "/x/../d is not an absolute path - not prerendered.",
      "/q?x=1 is not an absolute path - not prerendered.",
      "/%E0%A4%A is not an absolute path - not prerendered.",
      "7 is not an absolute path - not prerendered.",
    ]);
    expect(log).toHaveBeenCalledWith("Prerendered 1 page - 1 needs the server and renders in the browser - 2 redirect or not-found pages render in the browser.");
  });

  it("will count pages that decide in a real bundle, warning for a listed path no route matches", { timeout: 60_000 }, async () => {
    const { launch: real } = await vi.importActual<typeof import("./render")>("./render");
    const packages = fileURLToPath(new URL("../../../", import.meta.url));
    const config = `export default { resolve: { alias: [
      { find: /^@expressive\\/([^/]+)$/, replacement: ${JSON.stringify(packages)} + "$1/src" },
      { find: /^@expressive\\/([^/]+)\\/(.+)$/, replacement: ${JSON.stringify(packages)} + "$1/src/$2" },
    ] } };`;
    const root = built({
      "vite.config.mjs": config,
      "app/index.tsx": `export const Page = () => <p>home</p>;`,
      "app/(old).tsx": `import { Redirect } from "@expressive/dev"; export const Page = () => { throw new Redirect("/"); };`,
      "app/(away).tsx": `import { Redirect } from "@expressive/dev"; export const Page = () => { throw new Redirect("https://auth.example.com/login"); };`,
      "app/(lost).tsx": `import { NotFound } from "@expressive/dev"; export const Page = () => { throw new NotFound(); };`,
      "app/blog/[slug].tsx": `import { NotFound, Route } from "@expressive/dev";
        export const paths = () => ["/blog/a", "/blog/gone", "/blgo/typo"];
        export const Page = () => { const { slug } = Route.get().match; if (slug == "gone") throw new NotFound(); return <h1>{slug}</h1>; };`,
    }, `<html><head></head><body><div id="root"></div></body></html>`);

    launch.mockImplementationOnce(real);

    expect(await prerender(root)).toEqual(["/", "/blog/a"]);
    expect(warn.mock.calls.map(([message]: unknown[]) => message)).toEqual(["/blgo/typo matches no route - not prerendered."]);
    expect(log).toHaveBeenCalledWith("Prerendered 2 pages - 4 redirect or not-found pages render in the browser.");
  });

  it("will render a path encoded, as a browser reports it, into its decoded folder", async () => {
    const root = built({ "app/blog/[slug].tsx": PAGE + "; export const paths = () => [];" });
    const render = vi.fn((path: string) => ({ html: path }));

    renderer(render, ["/blog/a b", "/blog/caf%C3%A9"]);

    expect(await prerender(root, { pretty: true })).toEqual(["/blog/a%20b", "/blog/caf%C3%A9"]);
    expect(render.mock.calls.map(([path]) => path)).toEqual(["/blog/a%20b", "/blog/caf%C3%A9"]);
    expect(readFileSync(join(root, "dist", "client", "blog", "a b", "index.html"), "utf8")).toContain(`data-prerender="/blog/a%20b"`);
    expect(readFileSync(join(root, "dist", "client", "blog", "café", "index.html"), "utf8")).toContain(">/blog/caf%C3%A9</div>");
    expect(launch).toHaveBeenCalledWith(root, { pretty: true });
  });

  it("will summarize one route decision", async () => {
    const root = built({ "app/index.tsx": PAGE, "app/(old).tsx": PAGE });
    renderer(path => path == "/old" ? { path: "/" } : {});

    expect(await prerender(root)).toEqual(["/"]);
    expect(warn).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Prerendered 1 page - 1 redirect or not-found page renders in the browser.");
  });

  it("will leave pages that call the server to the client quietly", async () => {
    const root = built({ "app/index.tsx": PAGE, "app/(a).tsx": PAGE, "app/(b).tsx": PAGE });

    renderer(path => (path == "/" ? {} : null));

    expect(await prerender(root)).toEqual(["/"]);
    expect(warn).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Prerendered 1 page - 2 need the server and render in the browser.");
  });

  it("will not bundle the app when it has no page", async () => {
    const root = built({ "app/index.tsx": "export const x = 1;" });

    expect(await prerender(root)).toEqual([]);
    expect(launch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Prerendered 0 pages.");
  });

  it("will render a single-file app at its root", async () => {
    const root = built({ "app.tsx": "export default () => null" });
    renderer(() => ({ html: "app" }));

    expect(await prerender(root)).toEqual(["/"]);
    expect(readFileSync(join(root, "dist", "client", "index.html"), "utf8")).toContain(">app</div>");
  });

  it("will close the renderer if listing paths fails", async () => {
    const root = built({ "app/index.tsx": PAGE });
    const close = vi.fn();

    launch.mockResolvedValueOnce({ paths: async () => { throw new Error("no list"); }, render: vi.fn(), close });

    await expect(prerender(root)).rejects.toThrow("no list");
    expect(close).toHaveBeenCalled();
  });

  it("will throw if the shell has no head or no empty root", async () => {
    const message = `Prerendering needs a <head> and an empty <div id="root"> in the shell.`;

    await expect(prerender(built({ "app.tsx": "" }, `<html><head></head><body><div data-id="root"></div></body></html>`))).rejects.toThrow(message);
    await expect(prerender(built({ "app.tsx": "" }, `<html><body><div id="root"></div></body></html>`))).rejects.toThrow(message);
    expect(launch).not.toHaveBeenCalled();
  });
});

describe("fill", () => {
  const page = { html: "<h1>Hi</h1>", css: ".a{color: red;}", head: `<title>Hi</title><meta name="x" content="y"><link rel="icon" href="/i">`, path: `/a"&b` };

  it("will put head elements before the shell's title and the rules last in the head", () => {
    expect(fill(SHELL, page)).toBe(
      `<html><head><title data-prerender>Hi</title><meta data-prerender name="x" content="y"><link data-prerender rel="icon" href="/i"><title>Shell</title>` +
      `<style data-prerender>.a{color: red;}</style>\n</head><body><div id="root" data-prerender="/a&quot;&amp;b"><h1>Hi</h1></div></body></html>`
    );
  });

  it("will insert content verbatim, escaping a style end tag in the rules", () => {
    const out = fill(SHELL, { html: "$'", css: `.a::after{content: "$&"} </style>`, head: "<title>$`</title>", path: "/" });

    expect(out).toBe(
      `<html><head><title data-prerender>$\`</title><title>Shell</title><style data-prerender>.a::after{content: "$&"} <\\/style></style>\n</head>` +
      `<body><div id="root" data-prerender="/">$'</div></body></html>`
    );
  });

  it("will look for the shell's title only in its head, outside comments", () => {
    const shell = `<html><head><!-- <title>old</title> --></head><body><div id="root"></div></body></html>`;
    const out = fill(shell, { html: "<svg><title>icon</title></svg>", css: "", head: "<title>Hi</title>", path: "/" });

    expect(out).toBe(`<html><head><!-- <title>old</title> --><title data-prerender>Hi</title></head><body><div id="root" data-prerender="/"><svg><title>icon</title></svg></div></body></html>`);
  });

  it("will put head elements at the end of a head without a title, and skip what is empty", () => {
    const shell = `<html><head></head><body><div class="app" id='root'>\n</div></body></html>`;

    expect(fill(shell, { ...page, css: "" })).toBe(
      `<html><head><title data-prerender>Hi</title><meta data-prerender name="x" content="y"><link data-prerender rel="icon" href="/i"></head>` +
      `<body><div class="app" id='root' data-prerender="/a&quot;&amp;b"><h1>Hi</h1></div></body></html>`
    );
    expect(fill(shell, { ...page, css: "", head: "" })).toBe(`<html><head></head><body><div class="app" id='root' data-prerender="/a&quot;&amp;b"><h1>Hi</h1></div></body></html>`);
  });
});

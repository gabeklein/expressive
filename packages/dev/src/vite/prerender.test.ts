import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

function renderer(render: (path: string) => Partial<Page>, listed: string[] = []) {
  const close = vi.fn();

  launch.mockResolvedValueOnce({
    paths: async () => listed,
    render: async (path: string) => ({ path, html: path, css: "", head: "", ...render(path) }),
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
    expect(launch).toHaveBeenCalledWith(root);
    expect(log).toHaveBeenCalledWith("Prerendered 4 pages.");
  });

  it("will leave a page that moves, renders nothing or fails to the client", async () => {
    const root = built({ "app/(a).tsx": PAGE, "app/(b).tsx": PAGE, "app/(c).tsx": PAGE, "app/(d).tsx": PAGE });

    renderer(path => {
      if (path == "/a") return { path: "/" };
      if (path == "/b") return { html: "<!--fragment--> <!--/fragment-->" };
      if (path == "/c") throw new Error("broke");
      return {};
    }, ["relative", "/x/../d", "/q?x=1"]);

    expect(await prerender(root)).toEqual(["/d"]);
    expect(warn.mock.calls.map(([message]: unknown[]) => message)).toEqual([
      "/a redirected to / at build - left to the client.",
      "/b rendered nothing at build - left to the client.",
      "/c was not prerendered: broke",
      "relative is not an absolute path - not prerendered.",
      "/x/../d is not an absolute path - not prerendered.",
      "/q?x=1 is not an absolute path - not prerendered.",
    ]);
    expect(log).toHaveBeenCalledWith("Prerendered 1 page.");
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

  it("will throw if the shell has no empty root", async () => {
    const root = built({ "app.tsx": "" }, "<html><body></body></html>");

    await expect(prerender(root)).rejects.toThrow("Prerendering needs an empty #root element in the shell.");
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

  it("will put head elements at the end of a head without a title, and skip what is empty", () => {
    const shell = `<html><head></head><body><div class="app" id='root'>\n</div></body></html>`;

    expect(fill(shell, { ...page, css: "" })).toBe(
      `<html><head><title data-prerender>Hi</title><meta data-prerender name="x" content="y"><link data-prerender rel="icon" href="/i"></head>` +
      `<body><div class="app" id='root' data-prerender="/a&quot;&amp;b"><h1>Hi</h1></div></body></html>`
    );
    expect(fill(shell, { ...page, css: "", head: "" })).toBe(`<html><head></head><body><div class="app" id='root' data-prerender="/a&quot;&amp;b"><h1>Hi</h1></div></body></html>`);
  });
});

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
    expect(launch).toHaveBeenCalledWith(root, {});
    expect(log).toHaveBeenCalledWith("Prerendered 4 pages.");
  });

  it("will leave a page that moves, renders nothing or fails to the client", async () => {
    const root = built({ "app/(a).tsx": PAGE, "app/(b).tsx": PAGE, "app/(c).tsx": PAGE, "app/(d).tsx": PAGE });

    renderer(path => {
      if (path == "/a") return { path: "/" };
      if (path == "/b") return { html: "<!--fragment--> <!--/fragment-->" };
      if (path == "/c") throw new Error("broke");
      return {};
    }, ["relative", "/x/../d", "/q?x=1", "/%E0%A4%A", 7 as any]);

    expect(await prerender(root)).toEqual(["/d"]);
    expect(warn.mock.calls.map(([message]: unknown[]) => message)).toEqual([
      "/a redirected to / at build - left to the client.",
      "/b rendered nothing at build - left to the client.",
      "/c was not prerendered: broke",
      "relative is not an absolute path - not prerendered.",
      "/x/../d is not an absolute path - not prerendered.",
      "/q?x=1 is not an absolute path - not prerendered.",
      "/%E0%A4%A is not an absolute path - not prerendered.",
      "7 is not an absolute path - not prerendered.",
    ]);
    expect(log).toHaveBeenCalledWith("Prerendered 1 page.");
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

  it("will render pages beside a root remote, leaving those that call it to the client quietly", async () => {
    const root = built({
      "app/remote.ts": "export async function user() {}",
      "app/index.tsx": PAGE,
      "app/(privacy).tsx": PAGE,
      "app/account/index.tsx": PAGE,
      "app/account/(settings).tsx": PAGE,
      "app/board/remote/index.ts": "import { Model } from '@expressive/mvc'; export default class Board extends Model {}",
      "app/board/index.tsx": PAGE,
    });
    launch.mockResolvedValueOnce({
      paths: async () => [],
      render: async (path: string) => (path.startsWith("/account") || path == "/board" ? null : { path, html: path, css: "", head: "" }),
      close: vi.fn(),
    });

    expect(await prerender(root)).toEqual(["/", "/privacy"]);
    expect(warn).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Prerendered 2 pages - 3 call the server and render in the browser.");
  });

  it("will count one page that calls the server", async () => {
    const root = built({ "app/index.tsx": PAGE, "app/remote.ts": "export async function add() {}" });

    launch.mockResolvedValueOnce({ paths: async () => [], render: async () => null, close: vi.fn() });

    expect(await prerender(root)).toEqual([]);
    expect(log).toHaveBeenCalledWith("Prerendered 0 pages - 1 calls the server and renders in the browser.");
  });

  it("will not bundle the app when it has no page", async () => {
    const root = built({ "app/index.tsx": "export const x = 1;", "app/remote.ts": "export async function add() {}" });

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

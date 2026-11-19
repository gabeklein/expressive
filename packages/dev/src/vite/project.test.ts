// @vitest-environment happy-dom

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { bootstrap, ensureBootstrap, prerenderEntry, resolveProject } from "./project";

function project(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "project-"));

  for (const [file, source] of Object.entries(files)) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), source);
  }

  return root;
}

describe("resolveProject", () => {
  it("will find a single-file app with an index.ts and index.html", () => {
    const root = project({ "src/app.tsx": "", "index.ts": "", "index.html": "" });

    expect(resolveProject(root)).toEqual({
      root,
      appPath: join(root, "src/app.tsx"),
      configPath: join(root, "index.ts"),
      htmlPath: join(root, "index.html"),
    });
  });

  it("will throw if app/ and app.tsx both exist", () => {
    expect(() => resolveProject(project({ "app/index.tsx": "", "app.tsx": "" }))).toThrow("pick routed mode or single-file");
  });

  it("will throw if app.tsx and src/app.tsx both exist", () => {
    expect(() => resolveProject(project({ "app.tsx": "", "src/app.tsx": "" }))).toThrow("pick one");
  });

  it("will throw if there is no app", () => {
    expect(() => resolveProject(project({}))).toThrow("Missing app.tsx");
  });
});

describe("ensureBootstrap", () => {
  it("will add the root and script before </body>", () => {
    const html = ensureBootstrap("<html><body></body></html>");

    expect(html).toMatch(/<div id="root"><\/div>\n\s+<script type="module" src="\/\.expressive\/main\.tsx"><\/script>\n\s+<\/body>/);
  });

  it("will append both to a shell without </body>", () => {
    expect(ensureBootstrap("<p></p>")).toBe(
      `<p></p>\n<div id="root"></div>\n\n<script type="module" src="/.expressive/main.tsx"></script>\n`
    );
  });

  it("will keep a shell that already bootstraps", () => {
    const html = `<div id='root'></div><script type="module" src="/.expressive/main.tsx"></script>`;

    expect(ensureBootstrap(html)).toBe(html);
  });
});

describe("bootstrap", () => {
  const boot = () => {
    const hydrate = vi.fn();
    const render = vi.fn();
    const body = bootstrap("./app").replace(/^import .*$/gm, "");

    new Function("hydrate", "render", "jsx", "App", body)(hydrate, render, () => "app", undefined);

    return { hydrate, render };
  };

  const page = (path: string, head: string, body: string) => {
    history.replaceState(null, "", path);
    document.head.innerHTML = head;
    document.body.innerHTML = body;
  };

  it("will render into an empty root", () => {
    page("/", "", `<div id="root"></div>`);

    const { hydrate, render } = boot();

    expect(render).toHaveBeenCalledWith("app", document.getElementById("root"));
    expect(hydrate).not.toHaveBeenCalled();
  });

  it("will throw without a root", () => {
    page("/", "", "");

    expect(boot).toThrow("Missing #root element");
  });

  it("will hydrate a root prerendered for this path, unmarking what it adopts", () => {
    page("/about/", `<title data-prerender>About</title><title>Shell</title>`, `<div id="root" data-prerender="/about"><h1>About</h1></div>`);

    const { hydrate, render } = boot();

    expect(hydrate).toHaveBeenCalledWith("app", document.getElementById("root"));
    expect(render).not.toHaveBeenCalled();
    expect(document.head.innerHTML).toBe("<title>About</title><title>Shell</title>");
    expect(document.getElementById("root")!.hasAttribute("data-prerender")).toBe(false);
  });

  it("will hydrate a path the browser reports encoded", () => {
    page("/blog/a b", "", `<div id="root" data-prerender="/blog/a%20b"><h1>a b</h1></div>`);

    expect(boot().hydrate).toHaveBeenCalled();
  });

  it("will render over a root prerendered for another path, dropping its head", () => {
    page("/blog/three", `<title data-prerender>Home</title><style data-prerender></style><title>Shell</title>`, `<div id="root" data-prerender="/"><h1>Home</h1></div>`);

    const { hydrate, render } = boot();

    expect(render).toHaveBeenCalledWith("app", document.getElementById("root"));
    expect(hydrate).not.toHaveBeenCalled();
    expect(document.head.innerHTML).toBe("<title>Shell</title>");
    expect(document.getElementById("root")!.hasAttribute("data-prerender")).toBe(false);
  });
});

describe("prerenderEntry", () => {
  it("will list each dynamic module's paths", () => {
    const entry = prerenderEntry("./routes.tsx", ["../app/blog/[slug].tsx"]);

    expect(entry).toContain(`import { paths as p0 } from "../app/blog/[slug].tsx";`);
    expect(entry).toContain("await Promise.all([p0()])");
    expect(entry).toContain(`renderToString(jsx(App, { path }), { signal: abort.signal })`);
  });
});

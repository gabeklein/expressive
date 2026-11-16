import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, normalize } from "node:path";

import { PRERENDERED, resolveProject } from "./project";
import { launch, type Page } from "./render";
import { staticPaths } from "./routes";
import { scanExports } from "./scan";

export const SHELL = "200.html";

const ROOT = /(<div\b[^>]*\bid=["']root["'][^>]*)>\s*<\/div>/;
const HEAD = /<(title|meta|link)\b/g;
const PATH = /^\/[^?#]*$/;

/** Write `dist/client/<path>/index.html` for each static page, keeping the empty shell as `200.html`. */
export async function prerender(root: string): Promise<string[]> {
  const project = resolveProject(root);
  const dir = join(root, "dist", "client");
  const shell = readFileSync(join(dir, "index.html"), "utf8");
  const written: string[] = [];

  if (!ROOT.test(shell)) throw new Error("Prerendering needs an empty #root element in the shell.");

  writeFileSync(join(dir, SHELL), shell);

  const { paths, render, close } = await launch(root);

  try {
    const listed = project.appDir ? (await staticPaths(project.appDir, scanExports)).paths : ["/"];
    const queue = new Set([...listed, ...(await paths()).map(path => path.replace(/(.)\/$/, "$1"))]);

    for (const path of queue) {
      if (!PATH.test(path) || normalize(path) !== path) {
        console.warn(`${path} is not an absolute path - not prerendered.`);
        continue;
      }

      try {
        const page = await render(path);

        if (page.path !== path) {
          console.warn(`${path} redirected to ${page.path} at build - left to the client.`);
          continue;
        }

        if (!page.html.replace(/<!--[\s\S]*?-->/g, "").trim()) {
          console.warn(`${path} rendered nothing at build - left to the client.`);
          continue;
        }

        mkdirSync(join(dir, path), { recursive: true });
        writeFileSync(join(dir, path, "index.html"), fill(shell, page));
        written.push(path);
      } catch (error) {
        console.warn(`${path} was not prerendered: ${(error as Error).message}`);
      }
    }
  } finally {
    close();
  }

  console.log(`Prerendered ${written.length} page${written.length == 1 ? "" : "s"}.`);

  return written;
}

/** Put a rendered page into the shell: markup in `#root`, hoisted elements ahead of any `<title>`, rules last in the head. */
export function fill(shell: string, { html, css, head, path }: Page): string {
  const at = path.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const marked = head.replace(HEAD, `<$1 ${PRERENDERED}`);
  const style = css ? `<style ${PRERENDERED}>${css}</style>\n` : "";
  let out = shell.replace(ROOT, (_, open) => `${open} ${PRERENDERED}="${at}">${html}</div>`);
  const title = out.search(/<title\b/);

  if (marked) out = title >= 0 ? out.slice(0, title) + marked + out.slice(title) : out.replace("</head>", `${marked}</head>`);

  return out.replace("</head>", `${style}</head>`);
}

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";

import { PRERENDERED, resolveProject } from "./project";
import type { BuildOptions } from "./build";
import { launch, type Page } from "./render";
import { staticPaths } from "./routes";
import { scanExports } from "./scan";

export const FALLBACK = "200.html";

const ROOT = /(<div\b[^>]*(?<![-\w])id=["']root["'][^>]*)>\s*<\/div>/;
const HEAD = /<(title|meta|link)\b/g;
const PATH = /^\/[^?#]*$/;

/** Write `dist/client/<path>/index.html` for each static page, keeping the empty shell as `200.html`. */
export async function prerender(root: string, options: BuildOptions = {}): Promise<string[]> {
  const project = resolveProject(root);
  const dir = join(root, "dist", "client");
  const shell = readFileSync(join(dir, "index.html"), "utf8");
  const written: string[] = [];
  let served = 0;
  let decided = 0;

  if (!ROOT.test(shell) || !shell.includes("</head>")) throw new Error(`Prerendering needs a <head> and an empty <div id="root"> in the shell.`);

  writeFileSync(join(dir, FALLBACK), shell);

  const { paths: listed, sources } = project.appDir ? await staticPaths(project.appDir, scanExports) : { paths: ["/"], sources: [] };

  if (!listed.length && !sources.length) {
    console.log("Prerendered 0 pages.");
    return written;
  }

  const { paths, render, close } = await launch(root, options);

  try {
    const queue = new Set<unknown>([...listed, ...(await paths())]);

    for (const entry of queue) {
      const path = canonical(entry);

      if (!path) {
        console.warn(`${String(entry)} is not an absolute path - not prerendered.`);
        continue;
      }

      try {
        const page = await render(path);

        if (!page) {
          served++;
          continue;
        }

        if (page == "unmatched") {
          console.warn(`${path} matches no route - not prerendered.`);
          continue;
        }

        if (page == "decided" || page.path !== path) {
          decided++;
          continue;
        }

        if (!page.html.replace(/<!--[\s\S]*?-->/g, "").trim()) {
          console.warn(`${path} rendered nothing at build - left to the client.`);
          continue;
        }

        const folder = join(dir, decodeURI(path));

        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, "index.html"), fill(shell, page));
        written.push(path);
      } catch (error) {
        console.warn(`${path} was not prerendered: ${(error as Error).message}`);
      }
    }
  } finally {
    close();
  }

  const left = served ? ` - ${served} need${served == 1 ? "s" : ""} the server and render${served == 1 ? "s" : ""} in the browser` : "";
  const decisions = decided ? ` - ${decided} redirect or not-found page${decided == 1 ? "" : "s"} render${decided == 1 ? "s" : ""} in the browser` : "";

  console.log(`Prerendered ${written.length} page${written.length == 1 ? "" : "s"}${left}${decisions}.`);

  return written;
}

function canonical(path: unknown): string | undefined {
  if (typeof path != "string") return;

  try {
    const decoded = decodeURI(path).replace(/(.)\/$/, "$1");

    if (PATH.test(decoded) && posix.normalize(decoded) === decoded) return encodeURI(decoded);
  } catch {}
}

/** Put a rendered page into the shell: markup in `#root`, hoisted elements ahead of the head's `<title>`, rules last in the head. */
export function fill(shell: string, { html, css, head, path }: Page): string {
  const mark = path.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const marked = head.replace(HEAD, `<$1 ${PRERENDERED}`);
  const style = css ? `<style ${PRERENDERED}>${css.replace(/<\/(style)/gi, "<\\/$1")}</style>\n` : "";
  const end = shell.indexOf("</head>");
  const title = shell.slice(0, end).replace(/<!--[\s\S]*?-->/g, match => " ".repeat(match.length)).search(/<title\b/);
  const spot = title >= 0 ? title : end;
  const out = shell.slice(0, spot) + marked + shell.slice(spot, end) + style + shell.slice(end);

  return out.replace(ROOT, (_, open) => `${open} ${PRERENDERED}="${mark}">${html}</div>`);
}

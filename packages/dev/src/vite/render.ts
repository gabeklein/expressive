import { rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

import { prerenderBuild } from "./build";

export interface Page {
  html: string;
  css: string;
  head: string;
  path: string;
}

export interface Renderer {
  paths(): Promise<string[]>;
  render(path: string): Promise<Page>;
  close(): void;
}

/** Bundle the app for Node with client transforms - remote modules stay call stubs - and render pages from it. */
export async function launch(root: string): Promise<Renderer> {
  const outDir = join(root, "dist", ".prerender");
  const close = () => rmSync(outDir, { recursive: true, force: true });

  try {
    await build(prerenderBuild(root, outDir));

    const url = pathToFileURL(join(outDir, "prerender.js"));
    url.search = String(Date.now());

    const { default: render, paths } = await import(url.href);

    return { paths, render, close };
  } catch (error) {
    close();
    throw error;
  }
}

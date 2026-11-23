import { register } from "@expressive/env";
import { env } from "@expressive/env/vite";
import { build, type InlineConfig } from "vite";

import { nodeMode, viteConfigFile } from "./config";
import { host as app } from "./plugin";
import { PRERENDER_ENTRY } from "./project";

export interface BuildOptions {
  /** Unminified client output with stable filenames and no sourcemaps. */
  pretty?: boolean;
  /** Default true; false builds in memory. */
  write?: boolean;
  /** Default true; false skips prerendering, leaving every page to the browser. Otherwise each static page renders to `dist/client/<path>/index.html` after the build, keeping the empty shell as `200.html`; skipped when `write` is false, and a failure warns and leaves every page to the browser. */
  html?: boolean;
  /** Default true; false skips copying `.env` files into `process.env` - during the build and at the built server's boot. `env` reads them either way. */
  env?: boolean;
}

const host = ({ env: dotenv = true }: BuildOptions) => [app(dotenv), env()];

export function clientBuild(root: string, options: BuildOptions = {}): InlineConfig {
  const { pretty = false, write = true } = options;

  return {
    root,
    mode: nodeMode(),
    configFile: viteConfigFile(root),
    plugins: host(options),
    build: {
      write,
      outDir: "dist/client",
      minify: !pretty,
      sourcemap: !pretty,
      rollupOptions: pretty
        ? { output: { entryFileNames: "[name].js", chunkFileNames: "[name].js", assetFileNames: "[name].[ext]" } }
        : undefined,
    },
  };
}

export function serverBuild(root: string, options: BuildOptions = {}): InlineConfig {
  const { write = true } = options;

  return {
    root,
    mode: nodeMode(),
    configFile: viteConfigFile(root),
    plugins: host(options),
    build: {
      write,
      ssr: "/.expressive/server.ts",
      outDir: "dist/server",
      copyPublicDir: false,
      rollupOptions: { output: { entryFileNames: "app.js" } },
    },
  };
}

export function prerenderBuild(root: string, outDir: string, options: BuildOptions = {}): InlineConfig {
  const { pretty = false } = options;

  return {
    root,
    mode: nodeMode(),
    configFile: viteConfigFile(root),
    plugins: host(options),
    logLevel: "warn",
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      copyPublicDir: false,
      modulePreload: false,
      rollupOptions: {
        input: PRERENDER_ENTRY,
        preserveEntrySignatures: "strict",
        output: { format: "es", entryFileNames: "prerender.js", codeSplitting: false, ...(pretty && { assetFileNames: "[name].[ext]" }) },
      },
    },
  };
}

/** `expressive dev build` - the client into `dist/client`, then the server into `dist/server/index.js`, then any prerendered pages. */
export async function runBuild(root = process.cwd(), options: BuildOptions = {}): Promise<void> {
  if (options.env !== false) register();

  await build(clientBuild(root, options));
  await build(serverBuild(root, options));

  if (options.html === false || options.write === false) return;

  try {
    await (await import("./prerender")).prerender(root, options);
  } catch (error) {
    console.warn(`Prerendering failed - every page renders in the browser: ${(error as Error).message}`);
  }
}

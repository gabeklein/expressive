import { build, type InlineConfig } from "vite";

import { viteConfigFile } from "./config";
import { expressive } from "./plugin";
import { PRERENDER_ENTRY } from "./project";

export interface BuildOptions {
  /** Unminified client output with stable filenames and no sourcemaps. */
  pretty?: boolean;
  /** Default true; false builds in memory. */
  write?: boolean;
  /** Render each static page to `dist/client/<path>/index.html` after the build; the empty shell is kept as `200.html`. Skipped when `write` is false. */
  prerender?: boolean;
}

export function clientBuild(root: string, { pretty = false, write = true }: BuildOptions = {}): InlineConfig {
  return {
    root,
    configFile: viteConfigFile(root),
    plugins: [expressive()],
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

export function serverBuild(root: string, { write = true }: BuildOptions = {}): InlineConfig {
  return {
    root,
    configFile: viteConfigFile(root),
    plugins: [expressive()],
    build: {
      write,
      ssr: "/.expressive/server.ts",
      outDir: "dist/server",
      rollupOptions: { output: { entryFileNames: "index.js" } },
    },
  };
}

export function prerenderBuild(root: string, outDir: string, { pretty = false }: BuildOptions = {}): InlineConfig {
  return {
    root,
    configFile: viteConfigFile(root),
    plugins: [expressive()],
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
  await build(clientBuild(root, options));
  await build(serverBuild(root, options));

  if (options.prerender && options.write !== false) await (await import("./prerender")).prerender(root, options);
}

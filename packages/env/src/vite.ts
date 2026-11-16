import { posix } from "node:path";
import { normalizePath, type Plugin } from "vite";

import { write } from "./declaration";
import { reset } from "./env";
import { client, exposed } from "./client";

const ID = "@expressive/env";
const VIRTUAL = "\0@expressive/env";
const ENV_FILE = /^\.env(\.[\w.-]+)?$/;

export interface EnvOptions {
  /**
   * Keys the client may read start with this - default `"PUBLIC_"`.
   *
   * `false` sends every key in the `.env` files to the client.
   * `process.env` adds only prefixed keys, never with `false`.
   */
  prefix?: string | false;
}

/**
 * Serves `env` from `@expressive/env` to the client - only keys with the prefix, read at build.
 *
 * Server code keeps the real module, which reads from the working directory with mode `NODE_ENV`.
 * The client reads from Vite's `root` with Vite's `mode` - align them, or `--mode staging` gives each side different files.
 * In dev, writes `env.d.ts` and reloads when a root `.env*` file changes.
 */
export function env({ prefix = "PUBLIC_" }: EnvOptions = {}): Plugin {
  let root: string;
  let mode: string;
  let building = false;

  return {
    name: "expressive:env",
    enforce: "pre",

    config: () => ({ optimizeDeps: { exclude: [ID] } }),

    configResolved(config) {
      root = config.root;
      mode = config.mode;
      building = config.command === "build";
    },

    resolveId(id, _importer, options) {
      if (id === ID && !options?.ssr) return VIRTUAL;
    },

    load(id) {
      if (id !== VIRTUAL) return;

      const values = exposed(root, mode, prefix);

      if (building && !prefix) this.info(`every .env key reaches the client - ${Object.keys(values).length} sent, prefix is off.`);

      return client(values, prefix);
    },

    configureServer(server) {
      write(root);

      server.watcher.on("all", (_event, file) => {
        const path = normalizePath(file);

        if (posix.dirname(path) !== root || !ENV_FILE.test(posix.basename(path))) return;

        reset();
        write(root);

        const graph = server.environments.client.moduleGraph;
        const module = graph.getModuleById(VIRTUAL);

        if (module) graph.invalidateModule(module);
        server.ws.send({ type: "full-reload" });
      });
    },
  };
}

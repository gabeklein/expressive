import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import { normalizePath, type Plugin } from "vite";

import { DECLARATION, write } from "./declaration";
import { reset } from "./env";
import { isEnvFile } from "./files";
import { client, exposed } from "./client";

const NAME = "expressive:env";
const ID = "@expressive/env";
const VIRTUAL = "\0@expressive/env";

export interface EnvOptions {
  /**
   * Keys the client may read start with this word and an underscore - default `"PUBLIC"`.
   *
   * A trailing `_` is optional - `"CLIENT"` and `"CLIENT_"` both match `CLIENT_URL`.
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
 * In dev, reloads when a root `.env*` file changes and refreshes an existing `env.d.ts` - `expressive env` creates it.
 * A second `env()` in the same config does nothing, so one in `vite.config.ts` wins over a host's.
 */
export function env(options: EnvOptions = {}): Plugin {
  const { prefix: word = "PUBLIC" } = options;
  const prefix = word && word.replace(/_*$/, "_");
  let root: string;
  let mode: string;
  let building = false;
  let active = true;

  const plugin: Plugin = {
    name: NAME,
    enforce: "pre",

    config: () => ({ optimizeDeps: { exclude: [ID] } }),

    configResolved(config) {
      root = config.root;
      mode = config.mode;
      building = config.command === "build";
      active = config.plugins.find(each => each.name === NAME) === plugin;
    },

    resolveId(id, _importer, options) {
      if (active && id === ID && !options?.ssr) return { id: VIRTUAL, moduleSideEffects: false };
    },

    load(id) {
      if (id !== VIRTUAL) return;

      const values = exposed(root, mode, prefix);

      if (building && !prefix) this.info(`every .env key reaches the client - ${Object.keys(values).length} sent, prefix is off.`);

      return client(values, prefix);
    },

    configureServer(server) {
      if (!active) return;

      server.watcher.on("all", (_event, file) => {
        const path = normalizePath(file);

        if (posix.dirname(path) !== root || !isEnvFile(posix.basename(path))) return;

        reset();
        if (existsSync(join(root, DECLARATION))) write(root);

        const graph = server.environments.client.moduleGraph;
        const module = graph.getModuleById(VIRTUAL);

        if (module) graph.invalidateModule(module);
        server.ws.send({ type: "full-reload" });
      });
    },
  };

  return plugin;
}

import hot from "@expressive/dom/vite";
import inspect from "@expressive/inspect/vite";
import { createServer, type Plugin } from "vite";

import { viteConfigFile } from "./config";
import { expressive } from "./plugin";

export interface DevOptions {
  /** Serve inspect's `/__inspect` relay - default `true`. */
  inspect?: boolean;
}

/** `expressive dev` - a Vite dev server with the host plugin, dom's hot patching and, unless turned off, inspect's relay. */
export async function runDev(root = process.cwd(), { inspect: relay = true }: DevOptions = {}): Promise<void> {
  const host = expressive();

  const server = await createServer({
    root,
    configFile: viteConfigFile(root),
    plugins: [host, unlessAdded(hot() as unknown as Plugin), ...(relay ? [inspect()] : [])],
  });

  const { port } = await host.api!.config();

  await server.listen(port);
  server.printUrls();
}

export function unlessAdded(plugin: Plugin): Plugin {
  const transform = plugin.transform as Extract<Plugin["transform"], Function>;
  let added = false;

  const self: Plugin = {
    ...plugin,
    configResolved(config) {
      added = config.plugins.some(other => other.name === plugin.name && other !== self);
      return (plugin.configResolved as Function).call(this, config);
    },
    transform(...args) {
      if (!added) return transform.apply(this, args);
    },
  };

  return self;
}

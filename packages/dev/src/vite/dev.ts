import inspect from "@expressive/inspect/vite";
import { createServer } from "vite";

import { viteConfigFile } from "./config";
import { expressive } from "./plugin";

export interface DevOptions {
  /** Serve inspect's `/__inspect` relay - default `true`. */
  inspect?: boolean;
}

/** `expressive dev` - a Vite dev server with the host plugin and, unless turned off, inspect's relay. */
export async function runDev(root = process.cwd(), { inspect: relay = true }: DevOptions = {}): Promise<void> {
  const host = expressive();

  const server = await createServer({
    root,
    configFile: viteConfigFile(root),
    plugins: relay ? [host, inspect()] : [host],
  });

  const { port } = await host.api!.config();

  await server.listen(port);
  server.printUrls();
}

import { register } from "@expressive/env";
import { env } from "@expressive/env/vite";
import inspect from "@expressive/inspect/vite";
import { createServer } from "vite";

import { nodeMode, viteConfigFile } from "./config";
import { host as app } from "./plugin";

export interface DevOptions {
  /** Serve inspect's `/__inspect` relay - default `true`. */
  inspect?: boolean;
  /** Copy `.env` files into `process.env`, keys not already set - default `true`. `env` reads them either way. */
  env?: boolean;
}

/** `expressive dev` - a Vite dev server with the host plugin and, unless turned off, inspect's relay. */
export async function runDev(root = process.cwd(), { inspect: relay = true, env: dotenv = true }: DevOptions = {}): Promise<void> {
  const host = app(dotenv);

  if (dotenv) register();

  const server = await createServer({
    root,
    mode: nodeMode(),
    configFile: viteConfigFile(root),
    plugins: [host, env(), relay && inspect()],
  });

  const { port } = await host.api!.config();

  await server.listen(port);
  server.printUrls();
}

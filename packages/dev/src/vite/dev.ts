import { register } from "@expressive/env";
import { env } from "@expressive/env/vite";
import inspect from "@expressive/inspect/vite";
import { createServer } from "vite";

import { nodeMode, viteConfigFile } from "./config";
import { host as app } from "./plugin";

export interface DevOptions {
  /** Serve inspect's `/__inspect` relay - default `true`. */
  inspect?: boolean;
  /** Port to listen on - over `index.ts`'s `port` and Vite's. */
  port?: number;
  /** Copy `.env` files into `process.env`, keys not already set - default `true`. `env` reads them either way. */
  env?: boolean;
}

/** `expressive dev` - a Vite dev server with the host plugin and, unless turned off, inspect's relay. */
export async function runDev(root = process.cwd(), { inspect: relay = true, port, env: dotenv = true }: DevOptions = {}): Promise<void> {
  const host = app(dotenv);

  if (dotenv) register();

  const server = await createServer({
    root,
    mode: nodeMode(),
    configFile: viteConfigFile(root),
    plugins: [host, env(), relay && inspect()],
    server: port === undefined ? undefined : { port },
  });

  const configured = (await host.api!.config()).port;

  await server.listen(port ?? configured);
  server.printUrls();
}

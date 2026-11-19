import { env } from "@expressive/env/vite";
import inspect from "@expressive/inspect/vite";
import { createServer } from "vite";

import { viteConfigFile } from "./config";
import { expressive } from "./plugin";

export interface DevOptions {
  /** Serve inspect's `/__inspect` relay - default `true`. */
  inspect?: boolean;
  /** Load `.env` files - `env` for the app, keys not already set into `process.env`. Default `true`. */
  env?: boolean;
}

/** `expressive dev` - a Vite dev server with the host plugin and, unless turned off, inspect's relay. */
export async function runDev(root = process.cwd(), { inspect: relay = true, env: dotenv = true }: DevOptions = {}): Promise<void> {
  const host = expressive();

  const server = await createServer({
    root,
    mode: process.env.NODE_ENV || undefined,
    configFile: viteConfigFile(root),
    plugins: [host, dotenv && env(), relay && inspect()],
  });

  const { port } = await host.api!.config();

  await server.listen(port);
  server.printUrls();
}

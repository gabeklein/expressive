#!/usr/bin/env node
import { command, sub } from "@expressive/cli";
import { Model } from "@expressive/mvc";

class Expressive extends Model {
  dev = sub(() => import("./command/dev").then((module) => module.Dev), {
    help: "Vite dev server with HMR; /__inspect relay",
  });

  build = sub(() => import("./command/build").then((module) => module.Build), {
    help: "dist/client (static app) and dist/server/index.js (node service)",
  });
}

process.exitCode = await command(Expressive)(process.argv.slice(2), console);

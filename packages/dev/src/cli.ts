#!/usr/bin/env node
import { cmd, main } from "@expressive/cli";
import { Model } from "@expressive/mvc";

export { default } from "./command/dev";

class Expressive extends Model {
  dev = cmd({
    lazy: () => import("./command/dev"),
    help: "Run the app - Vite with HMR. Use `dev build` for production.",
  });

  env = cmd({
    peer: "@expressive/env",
    help: "Set up env.d.ts, then check, list and edit .env files without printing secrets.",
  });

  sql = cmd({
    peer: "@expressive/sql",
    help: "Check or sync a database schema against your entities.",
  });
}

main(import.meta, Expressive);

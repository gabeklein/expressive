#!/usr/bin/env node
import { cmd, main } from "@expressive/cli";
import { Model } from "@expressive/mvc";

export { default } from "./command";

class Expressive extends Model {
  dev = cmd({
    peer: "@expressive/dev",
    help: "Run the app - Vite with HMR. Use `dev build` for production.",
  });

  env = cmd({
    lazy: () => import("./command"),
    help: "Set up env.d.ts, then check, list and edit .env files without printing secrets.",
  });

  sql = cmd({
    peer: "@expressive/sql",
    help: "Check or sync a database schema against your entities.",
  });
}

main(import.meta, Expressive);

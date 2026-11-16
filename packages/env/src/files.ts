import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

export function mode(): string {
  return process.env.NODE_ENV || "development";
}

export function files(mode: string): string[] {
  return [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`];
}

export function parse(path: string): Record<string, string> {
  return existsSync(path) ? (parseEnv(readFileSync(path, "utf8")) as Record<string, string>) : {};
}

export function load(root: string, mode: string): Record<string, string> {
  return Object.assign({}, ...files(mode).map(file => parse(join(root, file))));
}

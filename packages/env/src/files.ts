import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

export function mode(): string {
  return process.env.NODE_ENV || "development";
}

export function files(mode: string): string[] {
  return [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`];
}

export function read(path: string): string | undefined {
  if (statSync(path, { throwIfNoEntry: false })?.isFile()) return readFileSync(path, "utf8").replace(/^\uFEFF/, "");
}

export function parse(path: string): Record<string, string> {
  const text = read(path);

  return text === undefined ? {} : (parseEnv(text) as Record<string, string>);
}

export function load(root: string, mode: string): Record<string, string> {
  return Object.assign({}, ...files(mode).map(file => parse(join(root, file))));
}

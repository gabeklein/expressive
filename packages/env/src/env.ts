import { load, mode } from "./files";

/** Keys of the project's `.env` files - `expressive env` declares them in `env.d.ts`. */
export interface Env {}

let cache: Record<string, string> | undefined;

export function reset() {
  cache = undefined;
}

function values() {
  return (cache ??= load(process.cwd(), mode()));
}

/**
 * The project's environment - `process.env` over the mode's `.env` files, read-only.
 *
 * Files load on first read from the working directory: `.env`, `.env.local`, `.env.[mode]`, `.env.[mode].local`, later winning.
 * Mode is `NODE_ENV`, default `development`.
 * `process.env` is never written.
 * Keys do not enumerate - spread, `Object.keys` and `JSON.stringify` see nothing.
 * In a client bundle the `env()` Vite plugin serves only keys with its prefix.
 */
export const env: Readonly<Env> = new Proxy({} as Env, {
  get: (_, key) => (typeof key === "string" ? (process.env[key] ?? values()[key]) : undefined),
  has: (_, key) => key in process.env || key in values(),
  set: () => false,
});

import { load, mode } from "./files";

/** Keys of the project's `.env` files - `expressive env` declares them in `env.d.ts`. */
export interface Env {}

let cache: Record<string, string> | undefined;
let filled: Set<string> | undefined;

export function reset() {
  cache = undefined;
  if (filled) register();
}

/**
 * Copies the mode's `.env` files into `process.env`, for dependencies that read it.
 *
 * Keys already set win, and `NODE_ENV` is never copied - the mode is chosen before files load.
 * Once registered, the Vite plugin's reload refreshes only the keys copied here.
 * `node --import @expressive/env/register` does the same before an app loads.
 */
export function register(): void {
  const values = load(process.cwd(), mode());
  const owned = (filled ??= new Set());

  for (const key of owned)
    if (!(key in values)) {
      delete process.env[key];
      owned.delete(key);
    }

  for (const [key, value] of Object.entries(values))
    if (key !== "NODE_ENV" && (owned.has(key) || process.env[key] === undefined)) {
      process.env[key] = value;
      owned.add(key);
    }
}

function values() {
  return (cache ??= load(process.cwd(), mode()));
}

/**
 * The project's environment - `process.env` over the mode's `.env` files, read-only.
 *
 * Files load on first read from the working directory: `.env`, `.env.local`, `.env.[mode]`, `.env.[mode].local`, later winning.
 * Mode is `NODE_ENV`, default `development`.
 * `process.env` is never written - import `@expressive/env/register` for that.
 * Keys do not enumerate - spread, `Object.keys` and `JSON.stringify` see nothing.
 * In a client bundle the `env()` Vite plugin serves only keys with its prefix.
 */
export const env: Readonly<Env> = new Proxy({} as Env, {
  get: (_, key) => (typeof key === "string" ? (process.env[key] ?? values()[key]) : undefined),
  has: (_, key) => key in process.env || key in values(),
  set: () => false,
});

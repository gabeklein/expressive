import { env as dotenv } from "@expressive/env";
import type { Env } from "@expressive/rpc";

/** `process.env`, then the mode's `.env` files, then `bound` - the first that has a key wins. Read-only. */
export function layered(bound: object = {}): Env {
  const files = dotenv as Record<string, unknown>;

  return new Proxy(bound as Env, {
    get: (_, key) => (typeof key == "string" && key in files ? files[key] : bound[key as never]),
    has: (_, key) => key in bound || key in files,
    set: () => false,
    deleteProperty: () => false,
    defineProperty: () => false,
  });
}

import { env as dotenv } from "@expressive/env";
import type { Env } from "@expressive/rpc";

/** `bound`'s live values, then `process.env`, then the mode's `.env` files, then `bound`'s strings. Read-only. */
export function layered(bound: object = {}): Env {
  const files = dotenv as Record<string, unknown>;

  return new Proxy(bound as Env, {
    get: (_, key) => {
      const own = bound[key as never];

      return typeof own == "string" || own === undefined ? (typeof key == "string" && key in files ? files[key] : own) : own;
    },
    has: (_, key) => key in bound || key in files,
    set: () => false,
    deleteProperty: () => false,
    defineProperty: () => false,
  });
}

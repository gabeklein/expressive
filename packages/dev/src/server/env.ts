import { env as dotenv } from "@expressive/env";
import type { Env } from "@expressive/rpc";

/** `bound` over `process.env`, then the mode's `.env` files - the first that has a key wins. Read-only. */
export function layered(bound: object = {}): Env {
  const files = dotenv as Record<string, unknown>;

  return new Proxy(bound as Env, {
    get: (_, key) => (key in bound || typeof key != "string" ? bound[key as never] : files[key]),
    has: (_, key) => key in bound || key in files,
    set: () => false,
  });
}

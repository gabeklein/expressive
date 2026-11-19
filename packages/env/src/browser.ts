import type { Env } from "./env";

export type { Env };

export const env: Readonly<Env> = new Proxy({} as Env, {
  get(_, key) {
    if (typeof key === "string" && /^[A-Z]/.test(key))
      throw new Error(`env.${key} has no value in the browser - add env() from "@expressive/env/vite" to the Vite config to expose prefixed keys.`);
  },
});

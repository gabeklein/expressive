import type { Env } from "@expressive/rpc";
import { isCall, scoped } from "@expressive/rpc/http";
import { bind, dispatch, install, verify, type Endpoint } from "@expressive/rpc/protocol";

import type { AppConfig, Ctx } from "./server/config";

/** An export of a server module - its index in the module list, and its name. */
export type Ref = [module: number, name: string];

/** One folder of remotes: its route pattern, and its calls and error classes by id. */
export interface Folder {
  pattern: string[];
  calls: Record<string, Ref>;
  classes: Record<string, Ref>;
}

type Handlers<T> = Omit<T, "port" | "remote" | "target" | "fetch">;

/**
 * The `target: "fetch"` server - the generated `dist/server/index.js` default-exports it.
 *
 * Answers remote calls, then `config.fetch`, else 404, with `env` bound for `Current.env`.
 * Members of `config` other than `port`, `remote`, `target` and `fetch` join the result.
 * Every folder's error classes verify on creation - a bad export fails at module load.
 */
export function fetchHandler<T extends AppConfig>(config: T, modules: Record<string, unknown>[], manifest: Folder[]): Handlers<T> & {
  fetch(request: Request, env?: Env, ctx?: Ctx): Promise<Response>;
} {
  install();

  const pick = (refs: Record<string, Ref>) =>
    Object.fromEntries(Object.entries(refs).map(([id, [module, name]]) => [id, modules[module][name]]));

  const sidecars: Endpoint[] = manifest.map(({ pattern, calls, classes }) => {
    const exports = { calls: pick(calls), classes: pick(classes) };
    verify("/" + pattern.join("/"), exports);
    return { pattern, exports: async () => exports };
  });

  const app = scoped(config);
  const { port, remote, target, fetch: _, ...handlers } = config;

  const later: Ctx = { waitUntil: promise => void promise.catch(error => console.error("waitUntil:", error)) };

  const respond = async (request: Request, env: Env, ctx: Ctx): Promise<Response> => {
    if (isCall(request)) return dispatch(request, () => sidecars, false);

    return (await app.fetch?.(request, env, ctx)) ?? new Response("Not found.", { status: 404 });
  };

  return {
    ...handlers,
    fetch(request, env = {}, ctx = later) {
      bind(request, env);
      return respond(request, env, ctx);
    },
  };
}

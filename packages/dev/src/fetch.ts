import type { Env } from "@expressive/rpc";
import { isCall, scoped } from "@expressive/rpc/http";
import { bind, dispatch, failure, install, verify, type Endpoint } from "@expressive/rpc/protocol";

import { wrap, type AppConfig, type Ctx } from "./server/config";

/** An export of a server module - its index in the module list, and its name. */
export type Ref = [module: number, name: string];

/** One folder of remotes: its route pattern, and its calls and error classes by id. */
export interface FolderRefs {
  pattern: string[];
  calls: Record<string, Ref>;
  classes: Record<string, Ref>;
}

type Handlers<T> = Omit<T, "port" | "remote" | "target" | "fetch" | "around">;

/**
 * The `target: "fetch"` server - the generated `dist/server/index.js` default-exports it.
 *
 * Answers remote calls, then `config.fetch`, else 404, with `env` bound for `Current.get().env`.
 * A call runs after the gates of its folder and those above.
 * `config.fetch`'s `next` resolves that 404.
 * Calls and `config.fetch` each run inside `config.around`.
 * `env` defaults to `{}`; `ctx` to a stand-in whose `waitUntil` logs a rejection.
 * Members of `config` other than `port`, `remote`, `target`, `fetch` and `around` join the result.
 * Throws on creation if a ref names no export or a folder's class is not an Error - a bad build fails at module load.
 */
export function fetchHandler<T extends AppConfig>(config: T, modules: Record<string, unknown>[], manifest: FolderRefs[], gates: { pattern: string[]; gate: Ref }[] = []): Handlers<T> & {
  fetch(request: Request, env?: Env, ctx?: Ctx): Promise<Response>;
} {
  install();

  const resolve = (pattern: string[], [module, name]: Ref) => {
    const value = modules[module]?.[name];
    if (value === undefined) throw new Error(`/${pattern.join("/")} has no export ${name}.`);
    return value;
  };

  const sidecars: Endpoint[] = manifest.map(({ pattern, calls, classes }) => {
    const path = "/" + pattern.join("/");
    const pick = (refs: Record<string, Ref>) =>
      Object.fromEntries(Object.entries(refs).map(([id, ref]) => [id, resolve(pattern, ref)]));
    const exports = { calls: pick(calls), classes: pick(classes) };

    verify(path, exports);
    return { pattern, exports: async () => exports };
  });

  const gateOf = new Map(gates.map(({ pattern, gate }) => [pattern.join("/"), resolve(pattern, gate) as () => unknown]));
  const gateAt = async (pattern: string[]) => gateOf.get(pattern.join("/"));

  const app = scoped(config);
  const { port, remote, target, fetch: _, around: __, ...handlers } = config;

  const later: Ctx = { waitUntil: promise => void promise.catch(error => console.error("waitUntil:", error)) };

  const missing = async () => new Response("Not found.", { status: 404 });

  const respond = async (request: Request, env: Env, ctx: Ctx): Promise<Response> => {
    const scope = { request, env, ctx };

    if (isCall(request)) return wrap(config, scope, () => dispatch(request, () => sidecars, false, gateAt)).catch(error => failure(error, sidecars, false));

    return (app.fetch && (await wrap(config, scope, async () => app.fetch!(request, env, ctx, missing)))) ?? missing();
  };

  return {
    ...handlers,
    fetch(request, env = {}, ctx = later) {
      bind(request, env);
      return respond(request, env, ctx);
    },
  };
}

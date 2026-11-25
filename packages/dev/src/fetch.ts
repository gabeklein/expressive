import type { Env, ExecutionCtx } from "@expressive/rpc";
import { install, verify, type Endpoint } from "@expressive/rpc/protocol";

import type { App, AppOptions, Settings } from "./settings";
import type { ApiRoute } from "./server/api";
import { compose as app, type Pages } from "./server/compose";

/** An export of a server module - its index in the module list, and its name. */
export type Ref = [module: number, name: string];

/** One folder of remotes: its route pattern, and its calls and error classes by id. */
export interface FolderRefs {
  pattern: string[];
  calls: Record<string, Ref>;
  classes: Record<string, Ref>;
}

/** The `api/` folder's modules as the entry imports them, and the prefix they serve under. */
export interface ApiRefs {
  prefix: string;
  routes: Omit<ApiRoute, "load">[];
}

/**
 * Entry plumbing, not app API: the `target: "fetch"` bundle's default export, which the generated entry builds.
 *
 * `settings.host`'s value given the app - an object without a `fetch` method gets the default `fetch(request, env, ctx)`; a class is exported as is.
 * The app's `assets` default to `env.ASSETS` when it has a `fetch`.
 * `api/` modules come in `apiModules`, described by `apiRefs` in the same order; `null` without an `api/` folder.
 * A call runs after the gates in `gates` of its folder and those above.
 * Throws on creation if a ref names no export or a folder's class is not an Error - a bad build fails at module load.
 */
export function compose(settings: Settings, modules: Record<string, unknown>[], manifest: FolderRefs[], apiModules: Record<string, unknown>[] = [], apiRefs: ApiRefs | null = null, pages?: Pages, gates: { pattern: string[]; gate: Ref }[] = []): { fetch(request: Request, env?: Env, ctx?: Partial<ExecutionCtx>): Promise<Response> } {
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

  const routes = apiRefs?.routes.map((ref, i) => ({ ...ref, load: () => apiModules[i] }));
  const api = routes && { prefix: apiRefs!.prefix, routes: () => routes };
  const inner = app(settings, { sidecars: () => sidecars, gates: async pattern => gateOf.get(pattern.join("/")), api, pages, base: pages?.base });
  const composed: App = (request, options = {}) => inner(request, { ...options, assets: options.assets ?? bound(options.env) });

  const fetch = (request: Request, env?: Env, ctx?: Partial<ExecutionCtx>) => composed(request, { env, ctx });
  const exported = settings.host?.(composed) as { fetch?: unknown } | undefined;

  if (!exported) return { fetch };
  if (typeof exported == "function" || typeof exported.fetch == "function") return exported as ReturnType<typeof compose>;

  return Object.assign(exported, { fetch });
}

function bound(env: object = {}): AppOptions["assets"] {
  const { ASSETS } = env as { ASSETS?: AppOptions["assets"] };

  if (typeof ASSETS?.fetch == "function") return ASSETS;
}

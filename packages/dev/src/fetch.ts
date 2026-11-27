import type { Env, ExecutionCtx } from "@expressive/rpc";
import { install } from "@expressive/rpc/protocol";

import type { App, AppOptions, Settings } from "./settings";
import type { ApiRoute } from "./server/api";
import { compose as app, type Pages } from "./server/compose";

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
 * `api/` modules come in `apiModules`, described by `apiRefs` in the same order - a ref's `calls` and `classes` name the exports a client may call and the error classes it may get; `null` without an `api/` folder.
 */
export function compose(settings: Settings, apiModules: Record<string, unknown>[] = [], apiRefs: ApiRefs | null = null, pages?: Pages): { fetch(request: Request, env?: Env, ctx?: Partial<ExecutionCtx>): Promise<Response> } {
  install();

  const routes = apiRefs?.routes.map((ref, i) => ({ ...ref, load: () => apiModules[i] }));
  const api = routes && { prefix: apiRefs!.prefix, routes: () => routes };
  const inner = app(settings, { api, pages });
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

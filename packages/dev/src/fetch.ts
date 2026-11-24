import type { Env, ExecutionCtx } from "@expressive/rpc";
import { install, verify, type Endpoint } from "@expressive/rpc/protocol";

import type { Settings } from "./settings";
import { compose as app } from "./server/compose";

/** An export of a server module - its index in the module list, and its name. */
export type Ref = [module: number, name: string];

/** One folder of remotes: its route pattern, and its calls and error classes by id. */
export interface FolderRefs {
  pattern: string[];
  calls: Record<string, Ref>;
  classes: Record<string, Ref>;
}

/**
 * Entry plumbing, not app API: the `target: "fetch"` bundle's default export, which the generated entry builds.
 *
 * `settings.host`'s value given the app, with a default `fetch(request, env, ctx)` where it has none.
 * Throws on creation if a ref names no export or a folder's class is not an Error - a bad build fails at module load.
 */
export function compose(settings: Settings, modules: Record<string, unknown>[], manifest: FolderRefs[]): { fetch(request: Request, env?: Env, ctx?: Partial<ExecutionCtx>): Promise<Response> } {
  install();

  const sidecars: Endpoint[] = manifest.map(({ pattern, calls, classes }) => {
    const path = "/" + pattern.join("/");
    const pick = (refs: Record<string, Ref>) =>
      Object.fromEntries(Object.entries(refs).map(([id, [module, name]]) => {
        const value = modules[module]?.[name];
        if (value === undefined) throw new Error(`${path} has no export ${name}.`);
        return [id, value];
      }));
    const exports = { calls: pick(calls), classes: pick(classes) };

    verify(path, exports);
    return { pattern, exports: async () => exports };
  });

  const composed = app(settings, { sidecars: () => sidecars });

  return {
    fetch: (request: Request, env?: Env, ctx?: Partial<ExecutionCtx>) => composed(request, { env, ctx }),
    ...settings.host?.(composed),
  };
}

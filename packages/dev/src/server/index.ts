import type { App, Settings } from "../settings";
import { compose as app } from "./compose";

export { listen, type ListenOptions } from "./listen";
export type { App, AppOptions } from "../settings";
export { Cookies, Current, type CookieOptions, type ExecutionCtx } from "@expressive/rpc";
export { register as registerEnv } from "@expressive/env";

/**
 * The app from an entry's settings: `handle` around calls and pages. For tests - no remotes or `api/` routes, and pages only through `assets`.
 *
 * @example
 * const app = compose(settings);
 * const page = await app(new Request("http://x/invite/abc"), { assets: { fetch: async () => new Response("<html></html>") } });
 */
export function compose(settings?: Settings): App {
  return app(settings);
}

import type { Env } from "@expressive/rpc";

/** What a host gives `fetch` as its third argument - Node and dev pass a stand-in. */
export interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}

/** Server settings - the default export of the app's `index.ts`. */
export interface AppConfig {
  /** Port to listen on - production defaults to 3000, dev to Vite's. Ignored by the `fetch` target. */
  port?: number;
  /** `opaque: false` keeps readable call names in a build, for clients that must outlive a deploy. Default hashed per build. */
  remote?: { opaque?: boolean };
  /**
   * What `dist/server/index.js` is - default `"node"`, a server that listens on `port` and serves `dist/client`.
   *
   * `"fetch"` bundles every dependency into a module for a fetch-handler host: `export default { fetch }` answering calls, then this config's `fetch`, else 404.
   * Static files are the host's - `fetch` forwards to them. Other members of this config join the default export, and named exports of `index.ts` other than `bindings` are re-exported.
   * Requests keep no state between them - a remote that default-exports a seat or exports a Model class fails the build.
   */
  target?: "node" | "fetch";
  /**
   * The app's own routes, after remote calls and before static files - return nothing to fall through.
   *
   * Runs in the request's scope: `Current` and `Cookies` work as in a call. `env` is the host's second argument - in dev under the `fetch` target, `bindings()` from `index.ts`; on Node, `{}`.
   * A body read here is gone for the static files after it - answer the request, or read a `clone()`.
   */
  fetch?(request: Request, env: Env, ctx: Ctx): Response | undefined | Promise<Response | undefined>;
}

/**
 * Types the server entry's settings - identity at runtime.
 *
 * @example
 * export default config({ port: 8080 });
 */
export function config<T extends AppConfig>(config: T): T {
  return config;
}

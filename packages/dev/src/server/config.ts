import type { Env } from "@expressive/rpc";

/** What a host gives `fetch` as its third argument - Node and dev pass a stand-in. */
export interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}

/** What `around` gets beside the work it wraps. */
export interface Scope {
  request: Request;
  /** The host's per-request bindings - `{}` on Node; in dev under the `fetch` target, `bindings()`. */
  env: Env;
  ctx: Ctx;
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
  /**
   * Wraps each remote call and the app's `fetch` - run `next` inside and resolve what it resolves.
   *
   * Runs on every host and target, around the call's scope - read the request from `scope.request`, not `Current`.
   * With a `fetch`, every request that is not a call runs inside it, including those `fetch` passes on - in dev, Vite's too.
   * Twin streams and the default export's other members skip it. The scope ends when `next` resolves - `ctx.waitUntil` work and a streamed body run after.
   * A rejection on a call replies as a call's error would - an error class a remote exports keeps its status.
   *
   * @example
   * config({ around: next => db.session(next) });
   */
  around?<T>(next: () => Promise<T>, scope: Scope): Promise<T>;
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

export function wrap<T>(config: AppConfig, scope: Scope, next: () => Promise<T>): Promise<T> {
  return config.around ? config.around(next, scope) : next();
}

import type { Env, ExecutionCtx } from "@expressive/rpc";

export type { Env } from "@expressive/rpc";

/** The app below `handle`: remote calls, then pages and static files. */
export type App = (request: Request, options?: AppOptions) => Promise<Response>;

/** What a host passes the app for one request. */
export interface AppOptions {
  /** This request's bindings, as `handle` and `Current.get().env` read them. Default `{}`. */
  env?: Partial<Env>;
  /** The host's execution context. Default: a stand-in whose `waitUntil` runs the promise and logs a rejection. */
  ctx?: Partial<ExecutionCtx>;
  /** Serves pages and static files - the last step of the chain. Without it, that step is a 404. */
  assets?: { fetch(request: Request): Promise<Response> };
}

/** What `handle` gets for each request. */
export interface HandleArgs {
  request: Request;
  env: Env;
  ctx: ExecutionCtx;
  /**
   * The app below: remote calls, then pages and static files. Resolves a `Response` with mutable headers.
   *
   * Forwards `request` if given, else the original; anything other than a `Request` throws.
   * Once per request, and only until `handle` returns. A throw below resolves its error reply.
   */
  next(request?: Request): Promise<Response>;
}

/** Server settings - the default export of the app's `index.ts`. */
export interface Settings {
  /**
   * What `dist/server/index.js` is - default `"node"`, a server on `port` serving `dist/client`.
   *
   * `"fetch"` bundles every dependency into a module exporting `host`'s value, else `{ fetch(request, env, ctx) }` over the app.
   * Folder gates do not run here - a remote entry with a default fails the build.
   */
  target?: "node" | "fetch";
  /** Port to listen on, on Node and in dev - production defaults to 3000, dev to Vite's, where `--port` wins. */
  port?: number;
  /** `opaque: false` keeps readable call names in a build, for clients that must outlive a deploy. Default hashed per build. */
  remote?: { opaque?: boolean };
  /**
   * Middleware around every request the host forwards - remote calls, pages and static files.
   *
   * Return a `Response` to answer, or nothing to pass: through `next()`'s reply if it was called, else by calling it.
   * Runs outside the request's scope - `Current`, `Cookies` and `get(Model)` throw here, and work inside `next()`.
   * A thrown `HttpError` answers its status, anything else a logged 500 - on a call, as a call's error.
   *
   * @example
   * config({ handle: ({ next }) => db.session(next) });
   */
  handle?(args: HandleArgs): Response | void | Promise<Response | void>;
  /**
   * Fetch target only: the bundle's default export, built from the app. Platform handlers (`scheduled`) go here.
   *
   * A returned object without `fetch` gets the default one. Dev never calls it.
   *
   * @example
   * config({ target: "fetch", host: () => ({ scheduled: (event: ScheduledController, env: Env) => sweep(env) }) });
   */
  host?(app: App): object;
}

/** Types the server entry's settings - returns them unchanged. */
export function config(settings: Settings): Settings {
  return settings;
}

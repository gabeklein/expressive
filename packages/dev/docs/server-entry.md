# The server entry and gates

Design note for reshaping `@expressive/dev`'s server entry, for sign-off before any implementation. Once agreed, the root `FEATURE.md` takes its outcome (lines superseded: question 4), and this file goes when the work lands.

## Why

0.5's `index.ts` default-exports `config({ port, target, remote, fetch, around, scheduled })`, and a named `bindings` export supplies dev's `env`. That shape has three problems:

- `fetch` reads as outbound. It is really a catch-all for requests that are not calls, so it overlaps `around`, which wraps the same requests.
- Unknown members (`scheduled`) pass through into the Worker's default export untyped. Any platform handler dev doesn't know about rides along by accident.
- Pages and static files are the app's job on the fetch target: an app carries its own `ASSETS`-plus-shell fallback, and a page rewrite built on it doesn't run in dev.

`fetch`, `around`, `target` and `bindings` shipped in 0.4.0 (#774, #777). `next()` followed in 0.5.0 (#794). Both releases are on npm. Neither has a known consumer outside a pinned preview build.

## Settled in review

- **`index.ts` default-exports `config({...})`.** `config` is an identity function for types, as Vite's `defineConfig` is, exported from `@expressive/dev`'s root. Processing stays in `/server`. There is no registry.
- **`handle({ request, env, ctx, next })` is plain fetch middleware around the app.** It replaces `fetch` and `around`: wrap with `next`, answer with a `Response`, pass by returning nothing. It runs outside the request scope, so no `Current` and no gate Models. One object argument, so a fetch handler can't be assigned to it by accident.
- **`host` is a `config` member**, the fetch bundle's default export built from the app.
- **Gates live in folders:** an `api/` folder `index.ts`'s `default`, and a remote entry's `default`. One rule, rpc's function gate with `next` optional: finish to pass, throw (or fail a Model's `new()`) to refuse, call `next` to wrap. Models a gate activates are in context below it.
- **Gates and `api/` routes take no parameters.** They read the request from `Current.get()`, so nothing needs a hand-typed `(request: Request, …)`.
- **`Current` carries the request and the reply:** `params`, `json()`, `text()`, `ctx`, `next` and `send` join `request`, `url`, `cookies`, `env` and `setHeader`.
- **`send` for after-work.** Code after `send` is after-work, which replaces an `after()` helper and a generator protocol. A route's returned value still answers; a gate answers only by `send` or a returned `Response` or function.
- **A returned function is a fetch handler,** called with `(request, env, ctx)`, so `export default () => legacy.fetch` mounts Hono or an auth library in an `api/` catch-all.
- **Outside a folder `index.ts`, an `api/` module's `default` is a catch-all.** No remainder export (`ANY`, `ELSE`).
- **`Current` stays pure.** `config` has no say over it. Per-request state lives in Models a gate activates; derived values (locale, client IP) are plain functions over `Current`, memoized on its `request` if costly; bindings extend `Env`. No request-wide Model or slot (Request-wide state, below).
- **A plain object sent or returned goes as JSON.**
- **`assets` defaults to `env.ASSETS` on the fetch target.**
- **Dev's stand-ins live in `index.dev.ts`.** When it exists, `expressive dev` reads its default export instead of `index.ts`'s. It imports `index.ts`'s settings, sets `env` (the live objects the host would pass, such as wrangler's local `DB`) and anything else dev-only, and exports them. The build never reads it, so nothing in it reaches a bundle. Replaces `bindings`.
- **Apps type `env` on `@expressive/dev`:** `declare module "@expressive/dev" { interface Env { … } }`. dev re-exports rpc's `Env`, so an app never names rpc.

## Shape

```ts
// index.ts - the app, in dev and production; d1 is the app's adapter from a D1 binding to sql's Engine
import { config, type Env } from "@expressive/dev";

declare module "@expressive/dev" {
  interface Env {
    DB: D1Database;
  }
}

export default config({
  target: "fetch",
  remote: { opaque: false },
  handle: ({ env, next }) => db.session(next, d1(env.DB)),
  host: () => ({
    scheduled: (event: ScheduledController, bound: Env) => db.session(() => sweep(), d1(bound.DB)),
  }),
});
```

```ts
// index.dev.ts - read by `expressive dev` instead, when present; never built
import type { Env } from "@expressive/dev";
import { getPlatformProxy } from "wrangler";
import settings from "./index";

settings.env = async () => (await getPlatformProxy<Env>()).env;

export default settings;
```

### Types

```ts
// @expressive/dev
export interface Settings {
  /** Default "node": a server on `port` serving dist/client. "fetch": a bundled module exporting `host`'s value, else `{ fetch(request, env, ctx) }` over the app. */
  target?: "node" | "fetch";
  /** Node and dev only. Default 3000 in production, Vite's in dev. `--port` wins. */
  port?: number;
  remote?: { opaque?: boolean };
  /** Dev only, and only in `index.dev.ts`: what the host would pass as `env` (wrangler's local platform for `DB`), over `process.env` and `.env`. Called once per server, again after a throw; a change needs a restart. */
  env?(): Partial<Env> | Promise<Partial<Env>>;
  /** Middleware around every request the host forwards. Return a `Response`, or nothing to pass. */
  handle?(args: HandleArgs): Response | void | Promise<Response | void>;
  /** Fetch target only: the bundle's default export, built from the composed app. Platform handlers (`scheduled`) go here; a missing `fetch` gets the default. */
  host?(app: App): object;
}

export interface HandleArgs {
  request: Request;
  env: Env;
  ctx: ExecutionCtx;
  /** The app below: calls, `api/`, pages. Forwards `request` if given, else the original; anything other than a `Request` throws. Once per request. Resolves a `Response` with mutable headers. */
  next(request?: Request): Promise<Response>;
}

/** Types the entry's settings; returns them unchanged. Not generic, so an unknown key is an editor error. */
export function config(settings: Settings): Settings;

/** The request's `env`. Augment it here: `declare module "@expressive/dev" { interface Env { DB: … } }`. */
export type { Env } from "@expressive/rpc";
```

```ts
// @expressive/dev/server
export interface AppOptions {
  /** This request's bindings, as `handle` and `Current.get().env` read them. Default `{}`. */
  env?: Partial<Env>;
  /** The host's execution context. Default: a stand-in whose `waitUntil` runs the promise and logs a rejection. */
  ctx?: Partial<ExecutionCtx>;
  /** Serves pages and static files - the last step of the chain. Default on the fetch target: `env.ASSETS`. */
  assets?: { fetch(request: Request): Promise<Response> };
}

/** The composed app: `handle` around calls, api routes and pages. */
export type App = (request: Request, options?: AppOptions) => Promise<Response>;

/** The app from an entry's settings. For tests: no remotes, api routes or pages. */
export function compose(settings?: Settings): App;
```

```ts
// @expressive/rpc - additions to Current
class Current {
  /** The matched route's params, decoded; a `[...]` segment under "*". A sidecar call's are its folder's. `{}` elsewhere. */
  get params(): Record<string, string>;
  /** The request body as JSON; `undefined` when empty. Rejects with `BadRequest` on invalid JSON or a content type other than `application/json` or `+json`. */
  json(): Promise<unknown>;
  /** The request body as JSON, passed through `check`. A throw from it rejects with `BadRequest` carrying its message; an `HttpError` keeps its status. */
  json<T>(check: (value: unknown) => T): Promise<Awaited<T>>;
  /** The request body as a string. */
  text(): Promise<string>;
  /** In a folder gate: wait for the Models this gate activated, run everything below and resolve with that reply. Calling it outside a gate throws; reading it never does. */
  get next(): () => Promise<Response>;
  /** The host's execution context, filled by a stand-in where the host lacks a member: `waitUntil` runs the promise and logs a throw, `passThroughOnException` does nothing, `props` is `{}`. */
  get ctx(): ExecutionCtx;

  /** Decide this layer's reply. Resolves once the reply is handed on; code after it is after-work. */
  send(body?: unknown): Promise<void>;
  send(status: number, body?: unknown): Promise<void>;
  static send(body?: unknown): Promise<void>;
  static send(status: number, body?: unknown): Promise<void>;
}

/** What `ctx` gives: the host's members, the stand-in's where it lacks them. */
export interface ExecutionCtx {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  props: Record<string, unknown>;
}

// @expressive/rpc/protocol
export function bind(request: Request, env: Env, ctx?: Partial<ExecutionCtx>): void;
```

The new getters keep a throwing setter, as `Current`'s do today, so mvc leaves them uncomputed (it skips a getter that has a setter). `json` and `text` are methods, mirroring `Request`'s, and mvc binds them, so they destructure. Form data and bytes come from `request` itself (`await request.formData()`), which reads the same cache (Body, below). `ExecutionCtx` lives in rpc and dev re-exports it; its `props` is what Hono's type requires.

`send`'s first argument: a number is a status, a `Response` is the whole reply, anything else is the body. A number as the body needs a status: `send(200, 42)`.

**A call reply that isn't the codec's** (a gate's `Response`, `handle`'s own, a host error page) rejects the call with an `HttpError` carrying its status and text, a 2xx included; today rpc's client fails parsing it. `handle`'s errors on a call request go out codec-shaped.

`@expressive/rpc/protocol` (host plumbing, beside `within`) gains the layer seam dev composes with, `layer(run: () => unknown, below: () => Promise<Response>, params?: Record<string, string>): Promise<Response>`: run a gate or handler with `below` as its `next` and `params` in the request's scope, and resolve with its reply. rpc's own function gates run on it, so they gain the optional `next` too (a transaction around each call). Under rpc's `scoped()`, the wrapped `fetch` is one layer: `send`, `json` and `text` work, `params` is `{}`, and calling `next` throws. `handler()` answers only calls, as today.

New public surface for sign-off (AGENTS.md):
- **dev root:** `config` (moved from `/server`), the types `Settings` and `HandleArgs`, and rpc's `Env` re-exported for augmenting, in an import-free module emitted as its own chunk, so the fetch bundle pulls no router or dom code for them.
- **dev `/server`:** `compose`, and the types `AppOptions`, `App`, `ExecutionCtx`. `Current` is already re-exported there.
- **dev `/fetch`:** `compose(settings, sidecars, manifest, routes, apiManifest, pages)`, for generated entries only.
- **rpc `Current`:** `params`, `json`, `text`, `ctx`, `next`, `send` and static `send`; the `ExecutionCtx` type; `next` in rpc's function gates, and a gate's returned `Response` or function answering.
- **rpc `/protocol`:** `bind`'s `ctx`, and `layer`.
- **rpc client:** a non-codec reply rejects with an `HttpError` carrying its status.
- **Behaviour:** an `HttpError` thrown outside a call, in `handle` or a gate, answers its status as JSON (`Redirect` sets `Location`); a gate's returned `Response` or function now answers where rpc ignored it.
- **dev's `index.dev.ts`:** read in place of `index.ts` by `expressive dev`; `env` allowed only there.
- **`@expressive/env`:** its generated keys type the request `env` (mechanism in PR 5).
- **Entry plumbing** on `/server`, documented as not app API: `listen` and its options. The three `compose` forms (`/server`'s, `/fetch`'s, dev's internal one) share one implementation.

Removed or renamed: `AppConfig` → `Settings`, `serve` → `listen` (the Node listener the generated entry calls), `@expressive/dev/fetch`'s `fetchHandler` → its `compose`, and the plugin API `Host.config()` returns `Settings`.

Apps augment `Env` through `@expressive/dev`, which re-exports rpc's interface; the merge reaches rpc's own declaration (checked with tsc 5.9), so `handle`, `Current.get().env` and `config.env` share it. rpc's docs keep `declare module "@expressive/rpc"` for apps without dev. The string keys `@expressive/env` generates should type the same `env`; whether rpc's `Env` extends `@expressive/env`'s or dev joins the two is PR 5's call.

### Semantics

- **`config`** returns its argument. Dev reads `index.ts`'s default export while Vite configures and when it composes the app. Node's entry needs `port` at runtime. Unknown keys fail the dev server and the build by name, the 0.5 ones included: "`fetch` and `around` became `handle`", "`scheduled` goes in `host`".
- **`handle`** runs for every request the host forwards: remote calls, `/api/*`, and pages and static files. A host that answers static files itself first (Workers assets without `run_worker_first`) never forwards those.
  - Without it, every request goes straight to the app.
  - Its reply is its returned `Response`. Returning nothing passes: through `next()`'s reply if it was called, else by calling it. Another return value throws. A second `next()`, or one after `handle` returned, throws. A `next()` reply `handle` discards has its body cancelled.
  - `next(request)` forwards a rewritten request; an argument that isn't a `Request` throws, so a wrapper that calls back with its own value (`db.transaction(next)`) fails loudly. To read the body and still pass it on, read `request.clone()`.
  - `next()` resolves a `Response` with mutable headers (re-wrapped where needed, 101 excepted), so `reply.headers.set(...)` works on an `assets` reply too.
  - It runs outside the request scope, so `Current`, `Cookies` and `get(Model)` throw there, and the request scope starts inside `next()`: `db.session(next, …)` puts all of it inside the session. Cookies go out on the `Response` it returns; work after the reply goes through `ctx.waitUntil`.
  - A thrown `HttpError` answers its status (codec-shaped on a call request, JSON `{ message }` otherwise); anything else is logged and answered with a 500 whose message shows in dev only.
  - Nothing passes from `handle` into the scope implicitly. Two channels: a header on `next(request)`, or the app's own `AsyncLocalStorage` around `next`, as `db.session(next)` does. `Current.get().request` is one object for the whole scope, so memoizing on it works in every gate and route, but not on `handle`'s `request`.
  - A 101 (WebSocket upgrade) from below passes through untouched; in dev, Vite's connect middleware never sees an upgrade, so this is fetch-target only.
- **`index.dev.ts`** is optional. When present, `expressive dev` reads its default export in place of `index.ts`'s. `env` set anywhere else (in `index.ts`, so in a build) fails the dev server and the build, pointing at `index.dev.ts`.
- **`host`** is optional, and only for the fetch target. It gets the composed app, and its return value becomes the bundle's default export.
  - Without it, the default export is `{ fetch: (request, env, ctx) => app(request, { env, ctx }) }`. A returned object without `fetch` gets that one, so `host` is only needed for what dev doesn't model.
  - Platform handlers (`scheduled`, `queue`, `email`) are the app's code, typed by the app. They run outside any request, so they read the platform's `env` argument.
  - Dev never calls `host`, so there is no cron in dev, as today.
  - On the Node target, a `host` fails the build and the dev server. Node has no module host to hand an export to.
- **`index.ts`'s named exports** are still re-exported from the fetch bundle (Durable Object and Workflow classes). A named `bindings` export fails the dev server and the build, pointing at `index.dev.ts`, so a half-migrated one can't ride into the Worker with its imports. The default is the settings, never re-exported.
- **`index.ts` is still optional.** Without it there are no settings, every request goes to the app, and the export is the default above.

### Gates

A gate is a folder's `default` function: an `api/` folder `index.ts`'s for that folder's paths (below), and a remote entry's for its folder's calls and gate checks. The same rule holds for both, and it is rpc's function gate with `next` added:

- **Finishing passes.** When the gate settles without deciding a reply and without calling `next`, the chain continues below it.
- **Refusing.** A throw refuses: on a call request it replies as a call's error would, so a gate can throw `Unauthorized` and keep its class. Elsewhere an `HttpError` answers its status with a JSON `{ message }` (`Redirect` sets `Location`), and anything else is a 500 whose message shows in dev only, logged. Activating a Model whose `new()` fails refuses with that Model's error.
- **Answering.** `send(...)`, or returning a `Response` or a function, answers instead of passing. Any other return value is ignored, so rpc's `() => guard()` idiom keeps working and a returned Model is not sent. On a call request a gate's reply goes out as is, and the client rejects the call with its status.
- **Context.** Every Model a gate activates is the request's own: found by `X.get()` in gates, routes and calls below, waited on until ready, destroyed when the request ends (after-work included).
- **Wrapping.** Calling `next()` first waits for the Models the gate has activated, refusing if one failed, so nothing below runs on an unverified session; `send` waits the same way. It then runs everything below and resolves with its reply. The gate may return it, return another, or `send` it and keep working; returning nothing after `next()` passes that reply through.

```ts
// api/account/index.ts - refuses or passes
export default () => {
  Session.new();   // its async new() reads the cookie; a failure refuses
};

// api/index.ts - wraps
export default async () => {
  const { next, send } = Current.get();
  const reply = await next();
  await send(reply);
  await log(reply.status);   // after-work
};
```

Not calling `next` is passing, so a forgotten `return next()` can't blank a folder. A wrapped `next()` that rejects without being returned is caught by the layer, not left unhandled.

### The request on `Current`

Every request below `handle` runs in one request scope, so `Current`, `Cookies` and `get(Model)` work in gates and routes as they do in calls. A call's rpc frame starts inside it. Each gate's scope encloses everything below it, so `next` and `params` are the reader's own. Destructuring captures them when read.

**A layer's reply is decided** by its first of:
- **`send(...)`.** The function keeps running.
- **Returning a value.** A `Response` as is, a function as a fetch handler; from a verb or catch-all, any other value as a body by the rule below, status 200. `undefined` from a gate passes (through `next()`'s reply if it was called); from a verb or catch-all it is 204.
- **Throwing**, as under Gates.

`next()` resolves with the reply below once that is decided, not when its function finishes. A throw below resolves `next()` with its error reply rather than rejecting, as a call's error does today, so a wrapper sees the same thing from a failed call and a failed route (question 7). The same holds for `handle`'s `next()`, so a transaction wrapper rolls back by checking the reply: `db.transaction(async () => { const reply = await next(); if (reply.status >= 500) throw new Rollback(reply); return reply; })`. A second `next()` throws.

**The reply leaves** when the outermost gate's reply is decided: `handle`'s `next()` resolves with it, or the host gets it. `send` resolves then, not when the body drains. It also resolves when a gate above swapped the reply or threw, and when the client aborts, so after-work never hangs.

**After a decided reply**, a second `send` or `setHeader` throws, a `Cookies.set` is dropped with a dev warning, and a return value other than `undefined` is ignored with a dev warning. Awaiting `next()` decides nothing, so a wrapping gate can still reply with what it got and keep working, as above.

**After-work.** Code after `send` runs once the reply has left. On the fetch target, the rest of the layer's promise goes to the host's `ctx.waitUntil`; on Node and in dev it just runs. A throw there is logged. The layer's own scope stays open until its function settles, so `Current`, `Cookies` and `get(Model)` still work, but `handle` may have returned: a wrapper like `db.session(next)` has closed. After-work and a lazily produced stream body still inherit that wrapper's `AsyncLocalStorage` store, a closed session included, so they open their own explicitly (`db.session(work, d1(env.DB))`, not a nested call that may join the ambient one). rpc's request frame (held seats, gated Models) is released once every layer has settled and every body produced in it has closed or been cancelled (question 9).

**Headers.** `setHeader` and `Cookies` join the reply of the layer that set them, when that reply is decided, so the `Response` `next()` resolves with already carries them; a passing gate's join the reply below. A gate that swaps the reply starts from the new one's headers. Order, lowest first: the body rule's content type, `setHeader`, a `Response`'s own headers (as `withHeaders` does today). The cookie flush re-arms per layer and diffs against what inner layers already emitted, so `Session.set()` after `await next()` reaches the outer reply once. `handle` sees the joined reply and sets its own headers on what it returns.

**`send`'s body rule**, shared with return values:
- plain objects, arrays, numbers, booleans and `null`: JSON, honouring `toJSON`. Any other object without `toJSON` throws ("send its values"): a Model, a `Map`, a class instance such as a Hono app returned without `.fetch`. So does `bigint`.
- a string: `text/plain`;
- `ArrayBuffer`, typed arrays, `DataView`, `Blob`, `FormData`, `URLSearchParams`, `ReadableStream`: as `Response` takes them;
- any other async iterable of strings or bytes (a Node `Readable`, an async generator): streamed through `ReadableStream.from`, or a small wrapper where a runtime lacks it;
- no body: 204 unless a status is given. Status otherwise defaults to 200. A body with 204, 304 or a 1xx status throws; 101 exists only on the fetch target.
- a function, returned only (`send` throws): a fetch handler, called as `fn(request, env, ctx)`, its result taken as the return value (a function again throws). See Dropping in a fetch handler.

**Streaming and pipes** use the platform's streams rather than a `write`/`end` API:

```ts
await send(200, (await fetch(upstream)).body);                              // proxy a body
await send(200, file.stream().pipeThrough(new CompressionStream("gzip")));  // transform
await send(200, createReadStream(path));                                    // a Node Readable is an async iterable

const { readable, writable } = new TransformStream();                       // push-style
await send(200, readable);                                                  // resolves at hand-off
await source.pipeTo(writable);
```

A throw mid-stream aborts the body and is logged; the status can't change by then. A reply a gate swapped or discarded has its body cancelled, and so does a HEAD reply's, so an upstream body never stalls. On Node and in dev, a JSON reply is buffered; a streamed one sets another type through `setHeader` (`application/x-ndjson`).

**Body.** `Current.get().request` is, from the start, a request whose body reads go through one cache: nothing is read until something asks, so answering early leaves no rejected promise behind, and the first read of any kind (`json()`, `text()`, `request.text()`, a mounted handler's `c.req.json()`) buffers the raw bytes once, which every later read derives from. The chain forwards that request, and call dispatch reads its arguments through it, so a gate that checks a signature leaves calls, catch-alls, `assets` and dev's fall-through (which replays the bytes into Node's `req`) intact. rpc's per-request maps (bindings, outgoing headers, cookie jars) and Node's abort signal stay keyed on the request the scope started with. `json()` and `text()` cap the body at 1 MB (413 `PayloadTooLarge`, question 6); raw reads and call arguments stay uncapped, as today. Unhandled, `json()`'s `BadRequest` answers 400.

**Validation.** `json(check)` infers `T` from the check, so a library's throwing parse types the body with no generic: `await json(Item.parse)` (zod), `await json(Event.assert)` (arktype), `await json(v => parse(User, v))` (valibot). There is no `json<T>()` without a check: it would be a cast that reads as validation. `(value: unknown) => T` is the one validation contract: rpc's call arguments reuse it later, whether the check is hand-written or generated from a call's parameter types by a build transform, which would also fill `json<T>()`.

**Inside a call**, calling `next` or `send`, `json` or `text`, throws: a call replies with its return value through rpc's codec. Reading them doesn't, so a shared helper can destructure `Current.get()`. `ctx` works, and `ctx.waitUntil` is a call's way to do work after its reply. `params` holds a sidecar call's folder params (`{ slug: "a" }` for `app/blog/[slug]/remote.ts` called from `/blog/a`).

### What the chain resolves, in order

Below `handle`:

1. **Remote call** (`isCall`, a gate check included): the folder's gates, then the call. A missing call is a JSON 404, as today.
2. **`/api/*`**: the folder's gates, then the matching `api/` route. An unmatched path is a JSON 404 and never the shell.
3. **Pages and static files**: the file, else `<path>/index.html`, else the shell, else 404. One shell rule on every host: only for GET or HEAD, and never under the build's `assetsDir`, so a stale chunk stays a 404 instead of becoming HTML with the wrong MIME type. A path some page route matches gets the shell with 200; a navigation (`accept` has `text/html`) no route matches gets it with 404, so a route's `NotFound` still renders. Anything else is a bare 404. (Node today falls back for any method and path; this narrows it.) Every entry carries the page patterns for the match.
   - **Node:** from `dist/client`, with the `assetsDir` cached immutable. The shell is `200.html`, else `index.html`.
   - **Dev:** a `public/` file, else the shell as Vite transforms it. Anything else falls through to Vite's middleware stack (below).
   - **Fetch target:** `assets.fetch(request)`; on a 404 that the shell rule covers, `assets.fetch` gets `/200.html` and then `/index.html`, keeping the method and following one same-origin redirect (an asset host that serves pretty URLs redirects these). This replaces the fallback each Workers app hand-writes today. `assets` defaults to `env.ASSETS` when that binding has a `fetch`; without either, the answer is 404. `<path>/index.html` is the asset host's job here, so a hand-written `assets` resolves it itself.
   - **Other methods** than GET and HEAD skip `assets` in a build and answer a bare 404 (Workers assets would answer 405 for a file's path).
   - **The public `compose(settings)`** has no shell rule: no page patterns, so a test's stubbed `assets` answers as is.
   - **Single-file apps** (`app.tsx`) have no patterns the build can see: every navigation gets the shell with 200, anything else a bare 404.
   - **Routes the scan can't see** (a custom root `Router`, a `<Route>` in a `Layout`) answer a deep link with the 404 shell; a `[...]` page claims their paths.
   - Where the status depends on `accept`, the reply carries `Vary: Accept`.

`assets` is otherwise written by hand only in tests (a stubbed shell) and for files kept elsewhere: `assets: { fetch: r => fetch(new URL(new URL(r.url).pathname, origin)) }`.

**In dev, `handle` sees what production would, and Vite keeps the rest.**
- Calls and `/api/*` are decided first, so they always go through `handle` and the gates.
- Vite's own URLs then skip `handle`: paths outside `base`, `/__inspect`, `/__open-in-editor`, `server.proxy`'s prefixes, `/@vite/*`, `/@id/*`, `/@fs/*`, `/node_modules/*`, `/.expressive/*` other than calls, the bare `?import`, `?url` and `?raw` flags (`?url=https://…` is not one), and paths naming a source file under the root outside `public/` and `api/`. Today `fetch` and `around` see them, which the README warns about.
- The page step must not starve later middlewares: inspect's `/__inspect` relay, other plugins' middlewares, `server.proxy`, `/__open-in-editor`. When the chain found no `public/` file and the request is not a navigation (its `accept` lacks `text/html`), it resolves a marked 404. Other plugins' middlewares are reached only through that mark, so a plugin page served to navigations outside the skip list gets the 404 shell instead: a known limit. The mark is a private header, stripped before sending and valid only while the status is still 404, so it survives `handle` copying the reply. Then the middleware hands the request to Vite's stack, applies the headers `handle` added to Node's `res` first, and replays the request `next` forwarded, body included. A throw in the page step (the shell transform) goes to Vite's error middleware, as today.

## `api/`: routes by location

A root `api/` folder sits beside `app/` and is served under a fixed `/api` prefix. It uses `app/`'s path syntax for segments: `api/photo/[id].ts` serves `/api/photo/:id`, `api/auth/[...].ts` serves `/api/auth/*` (one segment or more, so `/api/auth` itself needs `api/auth/index.ts`), and `api/index.ts` serves `/api`. `/api` sits under Vite's `base`.

**Location makes a route, never its exports.** Every `.ts`, `.tsx`, `.js` or `.jsx` module under `api/` is a route, except `*.test.*`, `*.spec.*` and `.d.ts`. Unlike `app/`, a bare name is a route (`api/logout.ts` serves `/api/logout`), since `api/` holds no support modules; helpers live outside it, in `server/` for example. A `(name).ts` file, and `api/dev.ts` beside `api/dev/index.ts`, fail the build.

**Exports:**
- **`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`** answer that method on the module's own path. HEAD falls to GET, the host cancels the body, and `Allow` lists HEAD wherever GET is exported.
- **`default` in a folder's `index.ts` is the folder's gate** (Gates, above). It runs before every route in the folder and below, its own verbs included, outermost first, and for unmatched paths there too, so a refused caller gets the same answer for a route that exists and one that doesn't. A class `default` fails the build (an imported one at load): a function that activates the Model covers it, per request.
- **`default` in any other module is a catch-all**: it answers every method on its path. Beside verbs it fails the build.
- **Any other runtime export fails the build**, so `export const Get` or a stray helper is caught rather than ignored. Type exports are fine. `api/index.ts`'s are reserved (question 4).
- A module with neither verbs nor a catch-all fails the build and the dev server, except a folder `index.ts` with only a gate.

The chain for `/api/account/me`: `handle` → `api/index.ts`'s gate → `api/account/index.ts`'s → `api/account/me.ts`'s verb or catch-all. A gate sees its own folder's params, the prefix it covers, so it reads the same `params.org` on an unmatched path as on a matched one; routes see the full match's. Past the gates: a path no module matches is a 404, a module with no handler for its own path is a 404, and a module whose verbs don't include the method is a 405 with `Allow`.

```ts
// api/dev/index.ts - gates /api/dev and everything under it
export default () => {
  if (Current.get().env.DEV_LOGIN !== "1") throw new NotFound();
};

// api/account/index.ts - Session's async new() verifies the cookie, throwing Unauthorized to refuse
export default () => {
  Session.new();
};

// api/account/me.ts - finds the gate's instance
export const GET = () => Session.get().user;

// api/photo/[id].ts
export const GET = () => photo(Current.get().params.id);

// api/auth/[...].ts - a catch-all
export default () => {
  const { env, request } = Current.get();
  return auth(env).handler(request);
};

// api/hook.ts
export async function POST() {
  const { json, send } = Current.get();
  const event = await json(Event.parse);
  await send(200);
  await process(event);   // after-work
}
```

Why gates by folder: a gate belongs to the routes it covers, so the gate and the matched path can't disagree (`/api/DEV/mail` against a string compare in `handle`), and moving a folder moves its gate. Sharing rpc's gate model gives calls and HTTP routes one rule for access and one for what a route finds in context.

**Other rules:**

- Matching is exact and case-sensitive, on the decoded segments of the path `handle` forwards, so an escape (`/api/%61dmin`) cannot route around a fixed folder and its gate. A malformed `%` escape is a 400, and an empty segment (`//`) never matches. That rules out the router's client matcher (`url.ts` lowercases literals and trims slashes); the api table gets a strict one. Precedence follows the page tree's sort (`routes.ts`): fixed, then `:param`, then `*`, with no backtracking: once a fixed folder matches a segment, a sibling `[param]` never takes the path, so `/api/admin/users` stays under `api/admin/index.ts`'s gate and 404s there if `admin/` lacks `users`.
- `api/` is server-only. A client module importing from it fails the build, as it would for another folder's sidecar.
- When a root `api/` exists, `app/api/`, `app/api.tsx`, `app/(api).tsx` and `public/api/` fail the dev server and the build, because `/api` belongs to the folder. A root `[slug]` page can't be reached at `/api` either, and the 404 there says so. Without `api/`, an app may still own `/api` itself.
- `api/` routes are not prerendered.

**Settled in PR 6:**

- 404 and 405 replies are JSON `{ message }`; only the 405 carries `Allow` (a 404 has no methods to list). The 404 names the path and says `/api` belongs to `api/`. A HEAD reply never has a body, error replies included.
- Only the six verbs dispatch; another method token (`default`, say) is a 405. OPTIONS is never synthesised - CORS and preflight go in `handle` or a folder gate.
- A trailing slash is an empty segment, so `/api/logout/` is a 404. A `[...]` param is the decoded rest of the path joined with `/`, under `"*"`; its first segment must be non-empty, later empty ones are kept (`/api/files/a//b` gives `a//b`), which suits a mounted app.
- Naming errors beyond the note's: a `(name)` folder, a `[...]` folder (it takes the rest - a file only), `[...name]` (use `[...]` or `[name]`), a name starting with `:` or `*` (the table reads those as params), and two `[param]` names in one folder (`[id].ts` beside `[slug]/`), which would take the same segment. The `/api` reservations compare case-insensitively.
- Export rules are checked by the build (statically, after types are stripped) and in dev as each module loads, which also catches an imported class gate and a verb or `default` that isn't a function - that request answers a 500 naming the file, and each save under `api/` logs the folder's errors. Built hosts don't re-check, so none of it ships in a bundle; an imported class gate in a build fails at its first request. A naming error in dev fails every `/api` request until fixed; the reservations fail the dev server at start.
- The client import guard checks every client import's resolved id, so an alias into `api/` is caught too.
- The prefix is `base` + `api`, carried by each generated entry.
- Generated tables: Node's `listen({ ..., api: { prefix, routes: [{ name, path, index, module }] } })`, and `/fetch`'s `compose(settings, sidecars, manifest, apiModules, apiRefs, pages)` with `apiRefs` `{ prefix, routes: [{ name, path, index }] }` in `apiModules`' order (`null` without `api/`), its type exported beside `FolderRefs` as entry plumbing.

### Dropping in a fetch handler

A library or app with the platform's fetch signature, `(request, env, ctx) => Response` (Hono, an auth library's `handler`, a tRPC fetch adapter), mounts in a catch-all by returning the handler:

```ts
// api/legacy/[...].ts
const legacy = new Hono().basePath("/api/legacy").get("/users/:id", c => c.json(...));

export default () => legacy.fetch;
```

The handler is called detached, so a `fetch` that needs `this` (a prototype method; Hono's is an instance arrow) is returned bound: `() => app.fetch.bind(app)`. An app returned without `.fetch` throws (the body rule). The handler reads the body through the cache, its reply gets the headers and cookies gates set, and Models gates activated resolve inside it. Routes take no arguments, hence the arrow returning the handler. The path is not rewritten, so the mounted app keeps its base path, and `/api/legacy` itself is `api/legacy/index.ts`'s `export const GET = () => legacy.fetch` - a verb may return a handler too.

Around the whole app it goes in `handle`, which takes one object, so `handle: legacy.fetch` fails to type-check (and throws on the first request untyped) instead of silently answering every path. The 404 decision is written out:

```ts
handle: async ({ request, env, ctx, next }) => {
  const res = await legacy.fetch(request, env, ctx);
  return res.status === 404 ? next() : res;
},
```

`env` is the host's object on the fetch target, as Hono's `c.env` expects; on Node and in dev it is the layered view (`env`, below), so code reading `c.env.SECRET` runs on both. `passThroughOnException` is a no-op off Workers.

## Alignment with sidecars

`app/**/remote` calls and `api/` routes share `handle` around them, the request scope, `Current`'s request members (`request`, `url`, `cookies`, `env`, `ctx`, `params`, `setHeader`), `Cookies`, and one gate rule: a remote entry's `default` is its folder's function gate (#814), as an `api/` folder `index.ts`'s is. A sidecar gate covers its folder's calls and, through the gate check below, entry to its pages.

## Request-wide state

There is no Model every request gets, and none is needed:
- **Auth session:** a `Cookies` subclass (lazy, per request, readable anywhere in scope) plus an async `user()` memoized on `Current.get().request`; refusal in the folder gates that need it.
- **Tenant, locale:** plain functions over `Current`. A per-tenant database goes in `handle` (`db.session(next, tenantDb(env, host))`), a `lang` rewrite on `next()`'s reply.
- **Database session or transaction:** `handle` around `next`, since it must enclose the scope; per-call transactions are a gate with `next`.
- **Request id, timing, logging:** `handle`, shipping with `ctx.waitUntil`; read in scope through the app's own `AsyncLocalStorage` around `next` or a forwarded header.
- **Rate limiting:** by IP in `handle` (`throw new TooManyRequests()`), by user in a folder gate after the session; the counter is a module-scope service.

An eager Model for every call and route is two one-line gates (`app/remote.ts` and `api/index.ts`), and a forgotten one fails closed, since `X.get()` throws. Prefer the lazy forms: a root remote gate gates every page (Gate check).

## Gate check

A page under a gated folder would otherwise render before anything checked the caller, and its first parallel calls would each meet the gates. The client runs the gates once on the way in instead.

- **When.** A navigation sends one gate check for the deepest gated folder on its target path when that folder, at its concrete path (params filled), isn't covered by the last pass. First load counts. Leaving gated folders sends nothing. Every gated Route on the path waits on that one request. Only a pass is remembered; a refusal, a failure or a superseded check leaves nothing covered. Back and forward behave as any navigation. No opt-out.
- **Where gates are known.** The scan marks folders whose remote entry has a `default`, and the generated tree wraps their Routes' `enter`, so dev's `Route` gains no prop. Adding or removing a gate regenerates the tree. The checker gets the rendering route tree (segments in the router's order, with gate, page and `NotFound` marks), and finds the deepest gated folder by walking it as the router matches - a static sibling before a `:param` before `*` - so `/room/new` with an `app/room/(new).tsx` beside a gated `[id]/` checks nothing. The check path is the tree's literals plus the URL's param values, so a case variant checks the folder's own spelling. The wrapper comes from `gateCheck(call, tree, import.meta.hot)`, exported from `@expressive/dev`'s root as entry plumbing (like `/fetch`'s `compose`), given the generated `call` module and every gated folder's pattern; for a folder loaded on demand it also starts the module's import beside the check.
- **Wire.** A call request through rpc's client, so `configure({ base, headers, transport })` applies, to the deepest gated folder's path with its params, under rpc's existing `x-expressive-get` header with the value `gates` (non-empty, so no intermediary drops it). rpc's `call(path, "")` sends it - an empty name was never a callable one - and resolves `true` on a codec 200, `false` on a network failure, a non-codec reply or a codec 404 (a stale client after a gate-only folder is removed), rethrowing other codec refusals. Only `true` is remembered as a pass; `false` enters the page. It passes `handle`, runs each folder gate down to it, then answers `200 {}` with no function behind it, and a folder whose remote entry exports only the gate is registered as an endpoint with its error classes and no calls, so the check finds it and a refusal keeps its fields (in dev from the module, in a build from the scan). (`x-expressive-get` has no sender since #814; this reuses it; a named value still answers 404.) Cookies and headers the gates set join the reply. The marker lives in rpc's call dispatch; nothing new is exported from rpc.
- **Outcome.** A pass enters the Route; the Route's `enter` hook and its lazy chunk run after, the chunk's import started in parallel. A refusal goes through the call error codec, so the nearest `Catch` gets the typed class, and its `retry` sends a new check: `retry` re-arms every entry hook that refused, gated or not, so any hook runs again. An error with a 3xx `status` and a `location` redirects: a same-origin path some page route matches through the router; another path (a server route like `/api/auth/start`) or an `http:`/`https:` origin through `location.assign`; any other scheme to `Catch`. A gate that returns or sends a 3xx `Response` is answered as that error on a gate check, keeping the response's other headers. A redirect into a path the same refusing folder covers goes to `Catch` instead of looping, and so does a check that redirects right after a redirect (A to B to A). The loop mark is the error's `location` cleared, so `Route` needs no shared state. A 3xx error status on any codec reply goes out as HTTP 400 - not 500 - with `status` and `location` in the body; 3xx itself would let a 304 lose its body. A network failure, or a reply that isn't the codec's, passes: the page's own calls then fail through their gates.
- **Superseded.** A newer navigation drops an in-flight check's verdict and redirect; its cookies still land. Returning to the same folder at the same path while the check is in flight shares it. Superseded means the router's path no longer has that folder at that concrete path as its deepest gated one.
- **Not security.** Every call still runs its gates; skipping a check opens nothing.
- **No data.** A gate's return value stays ignored; the page reads what it needs through a remote function.
- **Idempotent gates.** The check and the calls after it all run the gates, possibly concurrently (a rotating refresh token must survive that). Rate limits and logs in gates and `handle` count checks too.
- **What it settles.** Cookies are settled before the entered page's calls, not before calls already in flight from the outgoing page or a layout, and not when a session expires while the user stays inside one gated folder: those calls still meet the gates on their own.
- **Cost.** One request per uncovered gated folder entered. Nothing persists between the check and the calls except cookies and module-scope state the app keeps (a verifier, a key set): warm on Node, best effort per isolate on Workers.
- **Fetch target.** Runs folder gates since PR 1, so its checks behave as on Node.
- **Prerender.** Paths under gated folders are not prerendered, and no check runs without `window`.
- **A root gate gates every page.** `app/remote.ts`'s `default` makes every page gated: nothing prerenders, and every cold load waits on one check. Use it to refuse; for context only (a session every call can read), use the lazy patterns under Request-wide state.
- **Hot reload.** An edited gate body clears the remembered passes, so the next navigation checks again. An edit to a helper the gate imports does not clear them.
- **Gate params.** A remote folder gate reads its folder's params from `Current.get().params`, as calls do (rpc passes the call's params to the gates along its folder).
- **Replaces** a hand-written sign-in check in a page folder's `enter` (`member() ? undefined : "/login"`): the gate throws `Redirect` instead, one round trip fewer.

"Gate check" is the user-facing name, since "preflight" is CORS's.

## Mechanics

### Settings at build

- The plugin's `config` hook loads `index.ts` with `runnerImport` and reads `target` and `remote` from its default export.
- `dev build` does that for each of its builds (client, server, and prerender when on).
- No transform: the build reads `index.ts` only, and `index.dev.ts` is never an input, so its imports (a local database driver, files) stay out of every bundle. `export default { port: 3000 }` and a settings constant still work, as in 0.5.
- Dev reads `index.dev.ts` when it exists, else `index.ts`, and watches both.
- `index.ts` loads in Node at build and in dev, so a static `cloudflare:workers` import (a Durable Object base class among its named exports) fails there: import such modules lazily or list them in `build.rollupOptions.external`, as the README says today.

### Generated entries

`/.expressive/server.ts` stays the one id; its load branches on dev or build, as it already branches on target.

**Fetch:**

```ts
import { compose } from "@expressive/dev/fetch";
import settings from "../index.ts";
import * as s0 from "../app/remote.ts";
import * as a0 from "../api/photo/[id].ts";
export { Room } from "../index.ts";   // index.ts's named exports, as today
export default compose(settings, [s0], manifest, [a0], apiManifest, pages);   // host's value, else { fetch(request, env, ctx) }
```

`/fetch`'s `compose` is `/server`'s with the tables and page patterns, built without Node imports.

**Node:** same imports. `listen({ settings, client, sidecars, gates, api, pages })` (today's `serve` in `/server`, renamed) composes and serves `app(request, { ctx, assets: dist/client })`, with the shell fallback above.

**Dev:** the plugin imports a virtual `/.expressive/server.ts`:

```ts
import settings from "../index.dev.ts";   // ../index.ts when there is none
import { compose } from "virtual:expressive/dev-compose";   // internal, not /server's
export default compose(settings, { sidecars, api, pages, dev: true });
```

The tables are the same generated ones, so an `api/` file added regenerates this entry. Dev's `compose` adds its endpoints; it stays internal, and the public `compose(settings)` is the tests' form.

- Its middleware calls `app(request, { env: await settings.env?.(), ctx, assets: public/ + Vite's shell })`.
- An edit to `index.ts`, `index.dev.ts` or anything they import invalidates the entry, so the next request re-evaluates both and picks up the new `handle`.
- Server patching in place (#745, #746) must treat `index.ts` as a re-evaluation boundary.

### Tests

```ts
import { compose } from "@expressive/dev/server";
import settings from "../index.ts";

const app = compose(settings);
const page = await app(new Request("http://x/invite/abc"), { env, assets: { fetch: async () => new Response(shell) } });
```

Outside a build, no remotes or api routes are composed, so this tests `handle`'s own logic (a sign-in link, a page rewrite) against a stubbed `assets`. Gates and routes read `Current`, so a route is tested through the app, not by calling its export. Settings are a plain object, so a test may compose them as often as it likes.

### `env`

`handle`'s `env` and `Current.get().env` read what the host bound. Off the fetch target, dev binds a layered view rather than the raw bindings:
- **Node and dev:** what the host passed (in dev, `index.dev.ts`'s `env()`), then `process.env`, then `.env` files; the first that has a key wins. So `env()` returns only live objects; string keys come from the layers below.
- **Fetch target:** the host's `env` object as is, so a library handed it (Hono's `c.env`) sees the platform's bindings. No file layer, so `node:fs`, `node:path` and `node:util` stay out of the bundle. The README's claim that it imports only `node:async_hooks` and `node:crypto` holds.

Outside a request (module scope, `scheduled`) there is no `Current`: handlers there take the platform's `env` argument, and Node code may use the root `env` (`@expressive/env`'s files-only reader shared with the client, unchanged). Reading `Current` there or in `handle` throws, and its message changes from "resolves only within a call" to "resolves only within a request"; dev adds the `handle` hint where it catches it.

## Migration

**Recommendation: break outright in 0.6.0 (`minor`), with no deprecated path.**

- `export default config({ port, remote })` dates to 0.1 and keeps its shape; `config`'s import moves to the root. `fetch`, `around`, `target` and `bindings` are in two published releases (0.4, 0.5). The only known consumer of the latter is on a pinned preview.
- A compatibility layer would keep the export-merging that this redesign exists to remove.
- The break is loud instead: old keys fail the dev server and the build, each naming its new home, with a link to the README section.

| 0.5 | 0.6 |
| --- | --- |
| `import { config } from "@expressive/dev/server"` | `from "@expressive/dev"` |
| `export default config({ port, target, remote })` | unchanged |
| `export async function bindings()` | `config.env = …` in `index.dev.ts` |
| `around: (next, { env }) => db.session(next, …)` | `handle: ({ env, next }) => db.session(next, …)` |
| `fetch(request, env, ctx, next)` answering paths | an `api/` route, or `handle` around `next()` |
| `fetch` returning nothing to fall through | `handle` returning nothing |
| `fetch` forwarding to `env.ASSETS` + shell fallback | nothing: `assets` defaults to `env.ASSETS` |
| `scheduled` (and other members) | `host`'s return value |
| `ctx.waitUntil(work)` in a handler | unchanged in `handle`; in gates and routes, `send` the reply, then do the work, or `Current.get().ctx` |
| `around`'s `scope.request`, `scope.env`, `scope.ctx` | `handle`'s argument; `Current.get()` in gates and routes |
| `around` wrapping calls only (no `fetch`) | `handle` wraps `api/`, pages and static files too |
| a throw in `fetch`: on the fetch target, reaching the host; on Node, a silent 400; in dev, Vite's error page | an `HttpError`'s status, else a logged 500 |
| `Cookies.set` or `X.get()` inside `fetch` (it ran in the request scope) | an `api/` route, or `Set-Cookie` on `handle`'s `Response` |
| `around` keeping a typed error's status on calls | unchanged, codec-shaped |
| Node's `Current.get().env` as `{}` | the layered view (`env`, below) |
| `bindings` on the fetch target only, in dev | `index.dev.ts` on either target |
| `declare module "@expressive/rpc" { interface Env }` | `declare module "@expressive/dev"` |
| `db.session(next, d1(env.DB))` | unchanged: `@expressive/sql`'s `session` takes an `Engine`, and `d1` is the app's adapter |
| `AppConfig` | `Settings` |
| `serve` from `/server` (generated entries only) | `listen` |
| `fetchHandler` from `/fetch` (generated entries only) | `compose` |

## Worked example

A Worker app: a database session per request on a D1 binding, an auth library, a dev-only sign-in link, a link-preview rewrite of one page, file routes and a cron. Under 0.5 it needed `around`, a path-matching `fetch`, its own `ASSETS`-plus-shell fallback, a `bindings` export and a pass-through `scheduled`.

It assumes the Worker runs before assets (`run_worker_first`). Otherwise the assets host answers `/?as=…` and, with single-page not-found handling, `/invite/:id` itself, and the sign-in link and the rewrite work in dev but not in production.

```ts
// index.ts
import { config, type Env } from "@expressive/dev";

import { db } from "./server/db";
import { d1 } from "./server/d1";   // the app's adapter from a D1 binding to sql's Engine
import { signInAs } from "./server/dev";
import { preview } from "./server/preview";
import { sweep } from "./server/jobs";

export default config({
  target: "fetch",
  remote: { opaque: false },

  handle: ({ request, env, next }) => {
    const url = new URL(request.url);

    return db.session(async () => {
      if (env.DEV_LOGIN === "1" && url.searchParams.has("as")) {
        const signedIn = await signInAs(url);
        if (signedIn) return signedIn;
      }

      const page = await next();
      const invite = request.method === "GET" && page.ok && url.pathname.match(/^\/invite\/([^/]+)$/);

      return invite ? preview(page, decodeURIComponent(invite[1])) : page;
    }, d1(env.DB));
  },

  host: () => ({
    scheduled(event: ScheduledController, bound: Env, ctx: ExecutionContext) {
      ctx.waitUntil(db.session(() => sweep(new Date(event.scheduledTime)), d1(bound.DB)));
    },
  }),
});
```

```ts
// index.dev.ts
import type { Env } from "@expressive/dev";
import { getPlatformProxy } from "wrangler";
import settings from "./index";

settings.env = async () => (await getPlatformProxy<Env>()).env;

export default settings;
```

`wrangler d1 migrations apply DB --local` creates the local tables before serving; dev does not run migrations.

```
api/auth/[...].ts     default: auth(env).handler(request) - the library's basePath becomes "/api/auth"
api/logout.ts         GET
api/photo/[id].ts     GET: the id from params, not parsed from the path
api/dev/index.ts      default: the DEV_LOGIN gate for everything under /api/dev
api/dev/mail.ts       GET
```

What the port shows:

- **The shell fallback leaves the app.** `next()` runs it over `env.ASSETS` without being told.
- **The page rewrite runs in dev too**, because `next()` returns Vite's shell there. Under 0.5 it needed `ASSETS`, so it ran only in production.
- **Per-request module globals go.** An app that copied `env` into a module global per request (so deep code could read it) reads `Current.get().env` instead. Concurrent requests in one isolate race on such a global.
- **Dev-only routes are gated by their folder**, not a prefix rule in `handle`.
- **`host` holds only the cron.** The default `fetch` is added. The cron opens its own session, since it is not a request.
- **Moving routes under `/api` is a URL change for the app.** Two things need care:
  - OAuth redirect URIs registered with a provider: add the new one before the deploy and remove the old one after.
  - Persisted URLs, such as a stored `/photo/<id>`, need a data rewrite. `handle` can keep a 308 from the old prefix for a release, for cached pages and installed PWAs.

## Questions

All answered in review.

1. **Static sugar.** Only `Current.send`, as `Cookies.set` is to `Cookies.get()`. Statics for `request`, `env` and the rest would duplicate the instance.
2. **Sending a Model instance** throws ("send its values"). Reserved while stateful server Models are undecided.
3. **Migration.** A clean break.
4. **`api/` was already assigned.** `FEATURE.md`'s agreed shape had dev hosting rpc's call folder at `api/` (lines 22, 83, 185, and 302's "dev does not host an rpc `api/` folder yet"). `api/` is HTTP routes only. `api/index.ts`'s extra exports stay reserved and fail the build. Typed verb arguments feeding an OpenAPI spec is a later idea, on the board.
   - `FEATURE.md` lines 22, 83, 185 and 302 get updated, along with 62 (the OAuth `api/` slice, now this) and 288 (REST verbs on a `Route` default). Line 233's "rpc folder, beyond calls" (REST verbs, the reply pipeline, OpenAPI) concerns rpc's external-client lane and stays. Line 21's Config line describes the new entry.
5. **Dev's stand-ins.** `index.dev.ts`, read by `expressive dev` in place of `index.ts` when present, sets `config.env`. No build transform, no literal rule, no flag. The member is `env`, named for what it fills.
6. **Body cap.** 1 MB by default, on `json()` and `text()` only, so calls and uploads keep today's behaviour. A setting to raise it (`config({ body: { limit } })`) waits until asked.
7. **A throw below a wrapper** resolves `next()` with the error reply, as calls already do, so a wrapper treats a failed call and a failed route alike.
8. **Trunk.** PRs 2 to 7 land on a `feat/dev-serve` trunk cut from this branch, released once. Publishing 0.6 with `handle` but without `api/` would make apps port twice. The trunk isn't released between PRs, so a gap one PR leaves for a later one is tolerated there (named below).
9. **Streams and scope.** The request frame is held until the body closes or is cancelled, and each pull runs in the request's store, so `Session.get()` inside a generator works as it does in after-work.

## PR split

Each PR has its own tests, a changeset where it is user-facing (`minor`), its README and skill section, and `hot-probe.ts` cases where it touches hot reload. In code, the layer and scope of this note take names distinct from `context.ts`'s `Layer` and `scope()`; gates build on its `gate()`.

1. **dev: folder gates on the fetch target.** Off `main`: a remote entry's function gate runs there (it is stateless now), lifting "The fetch target does not run folder gates". Independent of the trunk.
2. **rpc: the request on `Current`, and gates with `next`.** One scope per request, gates' scopes enclosing what they pass to, optional `next` on function gates, `params`/`json()`/`text()`/`ctx`/`next`/`send` and static `send`, a gate's answers (`send`, a returned `Response` or function; other returns ignored), a returned function as a fetch handler, `next` waiting for the gate's Models, decided-reply timing, header joining per layer, the body rule with streams and cancellation, the body cache with call dispatch reading through it, a call's frame starting inside the request scope, the frame held for streams (question 9), after-work through `bind`'s `ctx`, `layer` on `/protocol`, behaviour under `scoped()`, refusal mapping outside calls (`HttpError` status, `Redirect` `Location`), the client rejecting a non-codec reply with its status, the `Current` message change.
3. **dev: settings and composition.** `config` as the root's identity default export, `handle` and its `next`, `host` and its default `fetch`, `compose` and `listen`, generated entries, the chain for calls over today's page serving, sidecar call `params`, dev's skip list and fall-through, 101 passthrough, migration errors (old keys by name, a named `bindings` export). Updates the `FEATURE.md` lines in question 4. Hot-probe: an `index.ts` edit swaps `handle`. Gaps left on the trunk: the fetch target has no page fallback until PR 4, dev has no `env` stand-ins until PR 5, and 0.5 `fetch` routes have no home until PR 6.
4. **dev: pages over `assets`.** The one shell rule on every host (the page patterns in each entry, a navigation's 404 shell) and `assets` defaulting to `env.ASSETS`. Runtime check: a fetch-target build of the example app run under a local Workers runtime, plus Node.
5. **dev: `index.dev.ts` and the layered `env`.** Dev reading and watching `index.dev.ts`, `env` refused elsewhere, the named-`bindings` error, the layered view dev binds, the fetch build's file-free reader, `Env` re-exported from dev's root and `.env` keys typing it. Tests prove the bundle carries neither `index.dev.ts`'s imports, `node:fs`, nor router or dom code.
6. **dev: `api/` routes and gates.** Scan and strict matcher without backtracking, verbs, HEAD to GET, 404/405 with `Allow`, a `default` catch-all, the module-without-handler, naming and other-export errors, the `/api` reservations, the client import guard, generated tables and dev watch; a folder `index.ts`'s `default` as a gate over matched and unmatched paths with its folder's params, its Models in context until the request ends, and the class-default error; the example app. Hot-probe: an `api/` edit.
7. **dev: gate check.** The scan marking gated folders and the generated tree wrapping their `enter`, the rule for when a check is sent, the `x-expressive-get` branch answering `200 {}` after the gates, refusal through the codec to `Catch` with retry re-sending, redirects (router or `location.assign`, a 3xx `Response` mapped, no loops), superseded checks, prerender exclusion, clearing passes on a gate edit, the example's `enter` check replaced. Needs PR 1 to fire on the fetch target. Runtime: an example e2e spec (one check on entry, none inside the folder, one on a param change, refusal to `Catch`, redirect, zero requests in a gate-less app, a superseded navigation) under dev and the Node build, and a `hot-probe.ts` case for a gate edit.

PRs 1 and 2 are independent and can start together; 3 to 7 follow in order, except 5, which can run beside 4.

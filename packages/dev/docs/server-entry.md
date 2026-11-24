# The server entry and gates

Design note for reshaping `@expressive/dev`'s server entry, for sign-off before any implementation. Once agreed, the root `FEATURE.md` takes its outcome (lines superseded: open question 5), and this file goes when the work lands.

## Why

0.5's `index.ts` default-exports `config({ port, target, remote, fetch, around, scheduled })`, and a named `bindings` export supplies dev's `env`. That shape has three problems:

- `fetch` reads as outbound. It is really a catch-all for requests that are not calls, so it overlaps `around`, which wraps the same requests.
- Unknown members (`scheduled`) pass through into the Worker's default export untyped. Any platform handler dev doesn't know about rides along by accident.
- Pages and static files are the app's job on the fetch target: an app carries its own `ASSETS`-plus-shell fallback, and a page rewrite built on it doesn't run in dev.

`fetch`, `around`, `target` and `bindings` shipped in 0.4.0 (#774, #777). `next()` followed in 0.5.0 (#794). Both releases are on npm. Neither has a known consumer outside a pinned preview build.

## Settled in review

- **An `index.ts`'s `default` gates its folder.** The root `index.ts`'s gates every request; an `api/` folder's gates its paths. One rule at every level: finish to pass, throw (or fail a Model's `new()`) to refuse, call `next` to wrap. It replaces `fetch` and `around`.
- **Handlers take no parameters.** Gates and `api/` routes read the request from `Current.get()`, so nothing needs a hand-typed `(request: Request, …)`.
- **`Current` carries the request and the reply:** `params`, `json()`, `text()`, `ctx`, `next` and `send` join `request`, `url`, `cookies`, `env` and `setHeader`.
- **`send`, not a returned `Response`.** Code after `send` is after-work, which replaces an `after()` helper and a generator protocol. A route's returned value still answers; a gate answers only by `send` or a returned `Response` or function. `ctx` stays on `Current` for fetch handlers dropped in (below).
- **Gates are rpc's function gates, with `next` optional.** Models a gate activates are in context below it. Outside a folder `index.ts`, an `api/` module's `default` is a catch-all. No remainder export (`ANY`, `ELSE`).
- **A returned function is a fetch handler,** called with `(request, env, ctx)`, so `export default () => legacy.fetch` mounts Hono or an auth library without handlers taking parameters.
- **A plain object sent or returned goes as JSON.**
- **`assets` defaults to `env.ASSETS` on the fetch target.**

## Shape

`index.ts` calls `config()` and, optionally, `host()` at its top level, and default-exports the root gate.

```ts
import { config, host, Current } from "@expressive/dev/server";   // see open question 1
import type { Env } from "@expressive/rpc";

config({ target: "fetch", remote: { opaque: false }, bindings: async () => (await import("./dev-env")).bindings() });

host(() => ({
  scheduled: (event: ScheduledController, bound: Env) => db.session(() => sweep(), d1(bound.DB)),
}));

export default () => {
  const { env, next } = Current.get();
  return db.session(next, d1(env.DB));
};
```

### Types

```ts
// @expressive/dev/server
export interface Settings {
  /** Default "node": a server on `port` serving dist/client. "fetch": a bundled module exporting `host`'s value, else `{ fetch(request, env, ctx) }` over the app. */
  target?: "node" | "fetch";
  /** Node and dev only. Default 3000 in production, Vite's in dev. `--port` wins. */
  port?: number;
  remote?: { opaque?: boolean };
  /** Dev's per-request bindings (`env`) on either target, built once per server and again after a throw. The build drops it - import inside it. */
  bindings?(): Partial<Env> | Promise<Partial<Env>>;
}

export interface AppOptions {
  /** This request's bindings, as `Current.get().env` reads them. Default `{}`. */
  env?: Partial<Env>;
  /** The host's execution context. Default: a stand-in whose `waitUntil` runs the promise and logs a rejection. */
  ctx?: Partial<ExecutionCtx>;
  /** Serves pages and static files - the last step of the chain. Default on the fetch target: `env.ASSETS`. */
  assets?: { fetch(request: Request): Promise<Response> };
}

/** What `Current.get().ctx` gives: the host's members, the stand-in's where it lacks them. */
export interface ExecutionCtx {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  props: Record<string, unknown>;
}

/** The composed app: the root gate around calls, api routes and pages. */
export type App = (request: Request, options?: AppOptions) => Promise<Response>;

export function config(settings: Settings): void;
export function host<T>(build: (app: App) => T): void;

/** The app from an evaluated `index.ts`: its default as the root gate, with what is registered. Seals the registry. For tests: no remotes, api routes or pages. */
export function compose(entry: { default?: () => unknown }): App;
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
  /** In a gate: wait for the Models this gate activated, run everything below and resolve with that reply. Calling it outside a gate throws; reading it never does. */
  get next(): () => Promise<Response>;
  /** The host's execution context, filled by a stand-in where the host lacks a member: `waitUntil` runs the promise and logs a throw, `passThroughOnException` does nothing, `props` is `{}`. */
  get ctx(): ExecutionCtx;

  /** Decide this layer's reply. Resolves once the reply is handed to the host; code after it is after-work. */
  send(body?: unknown): Promise<void>;
  send(status: number, body?: unknown): Promise<void>;
  static send(body?: unknown): Promise<void>;
  static send(status: number, body?: unknown): Promise<void>;
}

// @expressive/rpc/protocol
export function bind(request: Request, env: Env, ctx?: Partial<ExecutionCtx>): void;
```

The new getters keep a throwing setter, as `Current`'s do today, so mvc leaves them uncomputed (it skips a getter that has a setter). `json` and `text` are methods, mirroring `Request`'s, and mvc binds them, so they destructure. Form data and bytes come from `request` itself (`await request.formData()`), which reads the same cache (Body, below). `ExecutionCtx` lives in rpc and is re-exported by dev; its `props` is what Hono's type requires.

`send`'s first argument: a number is a status, a `Response` is the whole reply, anything else is the body. A number as the body needs a status: `send(200, 42)`.

`@expressive/rpc/protocol` (host plumbing, beside `within`) gains the layer seam dev composes with: run a gate or handler with a given `next` and `params` in the request's scope, and resolve with its reply. rpc's own function gates run on it, so they gain the optional `next` too (a transaction around each call). Under rpc's `scoped()`, the wrapped `fetch` is one layer: `send`, `json` and `text` work, `params` is `{}`, and calling `next` throws. `handler()` answers only calls, as today.

New public surface for sign-off (AGENTS.md):
- **dev `/server`:** `config`, `host`, `compose`, and the types `Settings`, `AppOptions`, `App`, `ExecutionCtx`. `Current` is already re-exported there.
- **dev `/fetch`:** `compose(root, sidecars, manifest, routes, apiManifest, pages)`, for generated entries only.
- **rpc `Current`:** `params`, `json`, `text`, `ctx`, `next`, `send` and static `send`; the `ExecutionCtx` type; `next` in rpc's function gates, and a gate's returned `Response` or function answering.
- **rpc `/protocol`:** `bind`'s `ctx`, and the layer seam.
- **Behaviour:** an `HttpError` thrown outside a call answers its status as JSON.
- **`@expressive/env`:** its generated `.env` typing augments rpc's `Env` when dev is installed.
- **Entry plumbing** on `/server`, documented as not app API: `listen` and its options, and the registry reset the `index.ts` transform prepends.

Removed or renamed: `AppConfig` → `Settings`, `Scope` (gone), `serve` → `listen` (the Node listener the generated entry calls), `@expressive/dev/fetch`'s `fetchHandler` → its `compose`, and the plugin API `Host.config()` returns `Settings`.

`Env` is still augmented where `Current.get().env` reads it: `declare module "@expressive/rpc" { interface Env { … } }`. The `.env` typing `@expressive/env` generates augments rpc's `Env` as well when dev is installed, so `Current.get().env` types both layers.

### Semantics

- **`config`** holds build and run settings. Dev reads them while Vite configures. Only `bindings` leaves the bundle (below); Node's entry needs `port` at runtime.
- **The root gate** (`index.ts`'s default) runs for every request the host forwards: remote calls, `/api/*`, and pages and static files. A host that answers static files itself first (Workers assets without `run_worker_first`) never forwards those, so the root gate does not cover them.
  - Without one, every request passes.
  - A default export that is not a function fails the dev server and the build (0.5's config object included, below). So does `export default config(...)`, caught by the same scan that reads `config`'s literal.
  - A 101 (WebSocket upgrade) passes through unjoined, since rebuilding it drops the socket.
- **`host(build)`** is optional, and only for the fetch target. It gets the composed app, and its return value becomes the bundle's default export.
  - Without it, the default export is `{ fetch: (request, env, ctx) => app(request, { env, ctx }) }`. A returned object without `fetch` gets that one, so `host` is only needed for what dev doesn't model.
  - Platform handlers (`scheduled`, `queue`, `email`) are the app's code, typed by the app. They run outside any request, so they read the platform's `env` argument, not `Current`.
  - Dev never calls `build`, so there is no cron in dev, as today.
  - On the Node target, `host` fails the build and the dev server. Node has no module host to hand an export to.
- **`index.ts`'s named exports** are still re-exported from the fetch bundle (Durable Object and Workflow classes). A named `bindings` export fails the dev server and the build, pointing at `config({ bindings })`, so a half-migrated one can't ride into the Worker with its imports. The default stays the root gate, never re-exported.
- **`index.ts` is still optional.** Without it there are no settings, every request passes, and the export is the default above.

### Gates

A gate is an `index.ts`'s default function: the root `index.ts`'s for every request, a folder's under `api/` for that folder's paths (below). The same rule holds at every level, and it is rpc's function gate with `next` added:

- **Finishing passes.** When the gate settles without deciding a reply and without calling `next`, the chain continues below it.
- **Refusing.** A throw refuses: on a call request it replies as a call's error would, so a gate can throw `Unauthorized` and keep its class. Elsewhere an `HttpError` answers its status with a JSON `{ message }` (`Redirect` sets `Location`), and anything else is a 500 whose message shows in dev only, logged (today Node answers a bare 400). Activating a Model whose `new()` fails refuses with that Model's error.
- **Answering.** `send(...)`, or returning a `Response` or a function, answers instead of passing. Any other return value is ignored, so rpc's `() => guard()` idiom keeps working and a returned Model is not sent. On a call request a gate's reply goes out as is, and the client rejects the call with its status.
- **Context.** Every Model a gate activates is the request's own: found by `X.get()` in gates, routes and calls below, waited on until ready, destroyed when the request ends (after-work included). The root gate's Models reach sidecar calls too: a call's rpc frame starts inside the request scope.
- **Wrapping.** Calling `next()` first waits for the Models the gate has activated, refusing if one failed, so nothing below runs on an unverified session; `send` waits the same way. It then runs everything below and resolves with its reply. The gate may return it, return another, or `send` it and keep working; returning nothing after `next()` passes that reply through. So `db.session(next, …)` scopes everything below, and a gate can read or rewrite the reply.

```ts
// index.ts - refuses or passes, nothing to wrap
export default () => {
  Session.new();   // its async new() reads the cookie; a failure refuses
};

// index.ts - wraps
export default async () => {
  const { next, send } = Current.get();
  const reply = await next();
  await send(reply);
  await log(reply.status);   // after-work
};
```

Not calling `next` is passing, so a forgotten `return next()` can't blank the app. A wrapped `next()` that rejects without being returned is caught by the layer, not left unhandled.

### The request on `Current`

Every forwarded request runs in one request scope, so `Current`, `Cookies` and `get(Model)` work in gates and routes as they do in calls. Each gate's scope encloses everything below it, so `next` and `params` are the reader's own. Destructuring captures them when read.

**A layer's reply is decided** by its first of:
- **`send(...)`.** The function keeps running.
- **Returning a value.** A `Response` as is, a function as a fetch handler; from a verb or catch-all, any other value as a body by the rule below, status 200. `undefined` from a gate passes (through `next()`'s reply if it was called); from a verb or catch-all it is 204.
- **Throwing**, as under Gates.

`next()` resolves with the reply below once that is decided, not when its function finishes. A throw below resolves `next()` with its error reply rather than rejecting, as a call's error does today, so `db.session(next)` sees the same thing from a failed call and a failed route (open question 9). A second `next()` throws.

**The reply leaves** when the outermost layer's reply is decided. `send` resolves then: on hand-off to the host, not when the body drains. It also resolves when a gate above swapped the reply or threw, and when the client aborts, so after-work never hangs.

**After a decided reply**, a second `send` or `setHeader` throws, a `Cookies.set` is dropped with a dev warning, and a return value other than `undefined` is ignored with a dev warning. Awaiting `next()` decides nothing, so a wrapping gate can still reply with what it got and keep working, as above.

**After-work.** Code after `send` runs once the reply has left. On the fetch target, the rest of the layer's promise goes to the host's `ctx.waitUntil`; on Node and in dev it just runs. A throw there is logged. The layer's own scope stays open until its function settles, so `Current`, `Cookies` and `get(Model)` still work, but every gate above has returned: a wrapper like `db.session(next)` has closed, so after-work and a lazily produced stream body open their own session. rpc's request frame (held seats, gated Models) is released once every layer has settled and every body produced in it has closed or been cancelled (open question 11).

**Headers.** `setHeader` and `Cookies` join the reply of the layer that set them, when that reply is decided, so the `Response` `next()` resolves with already carries them; a passing gate's join the reply below. A gate that swaps the reply starts from the new one's headers. Order, lowest first: the body rule's content type, `setHeader`, a `Response`'s own headers (as `withHeaders` does today). The cookie flush re-arms per layer and diffs against what inner layers already emitted, so `Session.set()` after `await next()` reaches the outer reply once.

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

**Body.** `Current.get().request` is, from the start, a request whose body reads go through one cache: nothing is read until something asks, so answering early leaves no rejected promise behind, and the first read of any kind (`json()`, `text()`, `request.text()`, a mounted handler's `c.req.json()`) buffers the raw bytes once, which every later read derives from. The chain forwards that request, and call dispatch reads its arguments through it, so a gate that checks a signature leaves calls, catch-alls, `assets` and dev's fall-through (which replays the bytes into Node's `req`) intact. rpc's per-request maps (bindings, outgoing headers, cookie jars) and Node's abort signal stay keyed on the host's original request. `json()` and `text()` cap the body at 1 MB (413 `PayloadTooLarge`, open question 8); raw reads and call arguments stay uncapped, as today. Unhandled, `json()`'s `BadRequest` answers 400.

**Validation.** `json(check)` infers `T` from the check, so a library's throwing parse types the body with no generic: `await json(Item.parse)` (zod), `await json(Event.assert)` (arktype), `await json(v => parse(User, v))` (valibot). There is no `json<T>()` without a check: it would be a cast that reads as validation. `(value: unknown) => T` is the one validation contract: rpc's call arguments reuse it later, whether the check is hand-written or generated from a call's parameter types by a build transform, which would also fill `json<T>()`.

**Inside a call**, calling `next` or `send`, `json` or `text`, throws: a call replies with its return value through rpc's codec. Reading them doesn't, so a shared helper can destructure `Current.get()`. `ctx` works, and `ctx.waitUntil` is a call's way to do work after its reply. `params` holds a sidecar call's folder params (`{ slug: "a" }` for `app/blog/[slug]/remote.ts` called from `/blog/a`).

### What the chain resolves, in order

Below the root gate:

1. **Remote call** (`isCall`, a gate check included): dispatch to the sidecar. A missing call is a JSON 404, as today.
2. **`/api/*`**: the folder's gates, then the matching `api/` route. An unmatched path is a JSON 404 and never the shell.
3. **Pages and static files**: the file, else `<path>/index.html`, else the shell, else 404. One shell rule on every host: only for GET or HEAD, and never under the build's `assetsDir`, so a stale chunk stays a 404 instead of becoming HTML with the wrong MIME type. A path some page route matches gets the shell with 200; a navigation (`accept` has `text/html`) no route matches gets it with 404, so a route's `NotFound` still renders. Anything else is a bare 404. (Node today falls back for any method and path; this narrows it.) Every entry carries the page patterns for the match.
   - **Node:** from `dist/client`, with the `assetsDir` cached immutable. The shell is `200.html`, else `index.html`.
   - **Dev:** a `public/` file, else the shell as Vite transforms it. Anything else falls through to Vite's middleware stack (below).
   - **Fetch target:** `assets.fetch(request)`; on a 404 that the shell rule covers, `assets.fetch` gets `/200.html` and then `/index.html`, keeping the method and following one same-origin redirect (an asset host that serves pretty URLs redirects these). This replaces the fallback each Workers app hand-writes today. `assets` defaults to `env.ASSETS` when that binding has a `fetch`; without either, the answer is 404.

`assets` is otherwise written by hand only in tests (a stubbed shell) and for files kept elsewhere: `assets: { fetch: r => fetch(new URL(new URL(r.url).pathname, origin)) }`.

**A remote entry's `default` is a function gate.** Twins are removed in their own PR to `main`, which also makes a remote entry's `default` its folder's function gate and fails the build on a class. So nothing a call builds outlives the request, and sidecars gate the way `api/` folders do.

**In dev, the root gate sees what production would, and Vite keeps the rest.**
- Calls and `/api/*` are decided first, so they always go through the gates.
- Vite's own URLs then skip the root gate: paths outside `base`, `/__inspect`, `/__open-in-editor`, `server.proxy`'s prefixes, `/@vite/*`, `/@id/*`, `/@fs/*`, `/node_modules/*`, `/.expressive/*` other than calls, the bare `?import`, `?url` and `?raw` flags (`?url=https://…` is not one), and paths naming a source file under the root outside `public/` and `api/`. Today `fetch` and `around` see them, which the README warns about.
- The page step must not starve later middlewares: inspect's `/__inspect` relay, other plugins' middlewares, `server.proxy`, `/__open-in-editor`. When the chain found no `public/` file and the request is not a navigation (its `accept` lacks `text/html`), it resolves a marked 404. Other plugins' middlewares are reached only through that mark, so a plugin page served to navigations outside the skip list gets the 404 shell instead: a known limit. If the reply is that response untouched, the middleware hands the request to Vite's stack instead, without the headers the gates set. The mark survives header joining.

## `api/`: routes by location

A root `api/` folder sits beside `app/` and is served under a fixed `/api` prefix. It uses `app/`'s path syntax for segments: `api/photo/[id].ts` serves `/api/photo/:id`, `api/auth/[...].ts` serves `/api/auth/*` (one segment or more, so `/api/auth` itself needs `api/auth/index.ts`), and `api/index.ts` serves `/api`. `/api` sits under Vite's `base`.

**Location makes a route, never its exports.** Every `.ts`, `.tsx`, `.js` or `.jsx` module under `api/` is a route, except `*.test.*`, `*.spec.*` and `.d.ts`. Unlike `app/`, a bare name is a route (`api/logout.ts` serves `/api/logout`), since `api/` holds no support modules; helpers live outside it, in `server/` for example. A `(name).ts` file, and `api/dev.ts` beside `api/dev/index.ts`, fail the build.

**Exports:**
- **`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`** answer that method on the module's own path. HEAD falls to GET, the host cancels the body, and `Allow` lists HEAD wherever GET is exported.
- **`default` in a folder's `index.ts` is the folder's gate** (Gates, above). It runs before every route in the folder and below, its own verbs included, root first, and for unmatched paths there too, so a refused caller gets the same answer for a route that exists and one that doesn't. A class `default` fails the build (an imported one at load): a function that activates the Model covers it, per request.
- **`default` in any other module is a catch-all**: it answers every method on its path. Beside verbs it fails the build.
- **Any other runtime export fails the build**, so `export const Get` or a stray helper is caught rather than ignored. Type exports are fine. `api/index.ts`'s are reserved (open question 5).
- A module with neither verbs nor a catch-all fails the build and the dev server, except a folder `index.ts` with only a gate.

The chain for `/api/account/me`: the root gate → `api/index.ts`'s → `api/account/index.ts`'s → `api/account/me.ts`'s verb or catch-all. A gate sees its own folder's params, the prefix it covers, so it reads the same `params.org` on an unmatched path as on a matched one; routes see the full match's. Past the gates: a path no module matches is a 404, a module with no handler for its own path is a 404, and a module whose verbs don't include the method is a 405 with `Allow`.

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

Why gates by folder: a gate belongs to the routes it covers, so the gate and the matched path can't disagree (`/api/DEV/mail` against a string compare in the root gate), and moving a folder moves its gate. Sharing rpc's gate model gives calls and HTTP routes one rule for access and one for what a route finds in context.

**Other rules:**

- Matching is exact and case-sensitive, on raw segments of the path the root gate sees; params are decoded after the match. A malformed `%` escape is a 400, and an empty segment (`//`) never matches. That rules out the router's client matcher (`url.ts` lowercases literals and trims slashes); the api table gets a strict one. Precedence follows the page tree's sort (`routes.ts`): fixed, then `:param`, then `*`, with no backtracking: once a fixed folder matches a segment, a sibling `[param]` never takes the path, so `/api/admin/users` stays under `api/admin/index.ts`'s gate and 404s there if `admin/` lacks `users`.
- `api/` is server-only. A client module importing from it fails the build, as it would for another folder's sidecar.
- When a root `api/` exists, `app/api/`, `app/api.tsx`, `app/(api).tsx` and `public/api/` fail the dev server and the build, because `/api` belongs to the folder. A root `[slug]` page can't be reached at `/api` either, and the 404 there says so. Without `api/`, an app may still own `/api` itself.
- `api/` routes are not prerendered.

### Dropping in a fetch handler

A library or app with the platform's fetch signature, `(request, env, ctx) => Response` (Hono, an auth library's `handler`, a tRPC fetch adapter), mounts in a catch-all by returning the handler:

```ts
// api/legacy/[...].ts
const legacy = new Hono().basePath("/api/legacy").get("/users/:id", c => c.json(...));

export default () => legacy.fetch;
```

The handler is called detached, so a `fetch` that needs `this` (a prototype method; Hono's is an instance arrow) is returned bound: `() => app.fetch.bind(app)`. An app returned without `.fetch` throws (the body rule). Its 404 answers, so as the root gate, falling through to the app where it has no route, call it yourself:

```ts
export default async () => {
  const { request, env, ctx, next } = Current.get();
  const res = await legacy.fetch(request, env, ctx);
  return res.status === 404 ? next() : res;
};
```

The handler reads the body through the cache, its reply gets the headers and cookies gates set, and Models gates activated resolve inside it. `env` is the platform's bindings on the fetch target, as Hono's `c.env` expects; on Node and in dev it is the layered view (`env`, below), so code reading `c.env.SECRET` runs on both. `passThroughOnException` is a no-op off Workers.

## Alignment with sidecars

`app/**/remote` calls and `api/` routes share the request scope, `Current`'s request members (`request`, `url`, `cookies`, `env`, `ctx`, `params`, `setHeader`), `Cookies`, the root gate and its Models, and one gate rule: a remote entry's `default` is its folder's function gate, as an `api/` folder `index.ts`'s is (from the twins-removal PR). The difference left is reach: a sidecar gate covers its folder's calls and, through the gate check below, entry to its pages; the root gate covers every request.

## Gate preflight

A page under a gated folder would otherwise render before anything checked the caller, and its first parallel calls would each meet the gates. The client runs the gates once on the way in instead.

- **When.** A navigation sends one gate check for the deepest gated folder on its target path when that folder, at its concrete path (params filled), isn't covered by the last pass. First load counts. Leaving gated folders sends nothing, and the root gate, not in the route tree, never triggers one alone. Every gated Route on the path waits on that one request. Only a pass is remembered; a refusal, a failure or a superseded check leaves nothing covered. Back and forward behave as any navigation. No opt-out.
- **Where gates are known.** The scan marks folders whose remote entry has a `default`, and the generated tree wraps their Routes' `enter`, so dev's `Route` gains no prop. Adding or removing a gate regenerates the tree.
- **Wire.** A call request through rpc's client `send`, so `configure({ base, headers, transport })` applies, to the deepest gated folder's path with its params, under rpc's existing `x-expressive-get` header with no name. It runs the root gate and each folder gate down to it, then answers `200 {}` with no function behind it, so it doesn't 404 for a folder whose remote entry exports only the gate. Cookies and headers the gates set join the reply. The marker lives in rpc's call dispatch; nothing new is exported.
- **Outcome.** A pass enters the Route; the Route's `enter` hook and its lazy chunk run after, the chunk's import started in parallel. A refusal goes through the call error codec, so the nearest `Catch` gets the typed class, and its `retry` sends a new check. An error with a 3xx `status` and a `location` redirects: a path through the router, anything else through `location.assign`. A gate that returns or sends a 3xx `Response` is answered as that error on a gate check. A redirect into a path the same refusing folder covers goes to `Catch` instead of looping. A network failure, or a reply that isn't the codec's, passes: the page's own calls then fail through their gates.
- **Superseded.** A newer navigation drops an in-flight check's verdict and redirect; its cookies still land.
- **Not security.** Every call still runs its gates; skipping a check opens nothing.
- **No data.** A gate's return value stays ignored; the page reads what it needs through a remote function.
- **Idempotent gates.** The check and the calls after it all run the gates, possibly concurrently (a rotating refresh token must survive that). Rate limits and logs in gates count checks too.
- **What it settles.** Cookies are settled before the entered page's calls, not before calls already in flight from the outgoing page or a layout, and not when a session expires while the user stays inside one gated folder: those calls still meet the gates on their own.
- **Cost.** One request per uncovered gated folder entered. Nothing persists between the check and the calls except cookies and module-scope state the app keeps (a verifier, a key set): warm on Node, best effort per isolate on Workers.
- **Fetch target.** It refuses remote defaults today ("The fetch target does not run folder gates"), so it has no gated folders and sends no checks until that refusal lifts (PR split).
- **Prerender.** Paths under gated folders are not prerendered, and no check runs without `window`.
- **Hot reload.** An edited gate body clears the remembered passes, so the next navigation checks again.
- **Replaces** a hand-written sign-in check in a page folder's `enter` (`member() ? undefined : "/login"`): the gate throws `Redirect` instead, one round trip fewer.

"Gate check" is the user-facing name, since "preflight" is CORS's.

## Mechanics

### Registry

A module in dev, shared through one tsdown chunk by `dist/server/*` and `dist/fetch.js`, holds `{ settings?, build?, sealed }`. The root gate is not in it: the entry reads `index.ts`'s default directly.

- **Once per evaluation.** `config` and `host` each set their slot. A second call to the same one throws: "`host()` is already set - call it once, at `index.ts`'s top level."
- **Old keys throw too.** `config` rejects unknown keys by name, the 0.5 ones included: "`fetch` and `around` moved to `index.ts`'s default export …". This is the migration error.
- **Sealed when composed.** `compose` reads the registry and seals it. A call after that throws: "`config()` ran after the app was composed - call it at `index.ts`'s top level, not after an await or in a callback". That covers `target` being set after dev read it.
- **Reset when `index.ts` evaluates, and only then.** The plugin's transform prepends the reset to `index.ts` itself. Tying it to the entry would fail two ways. An entry re-run with `index.ts` cached (an `api/` file added regenerates the table) would reset and re-register nothing, silently dropping `host`. An `index.ts` patched in place would throw "after composed".
- **The plugin never imports the registry.** It reads settings through a module evaluated on the same runner as `index.ts`: the virtual entry in dev, and at build an inline-plugin virtual module passed to `runnerImport`. One instance then holds whatever resolves `@expressive/dev`: an installed package, the suite's `src` aliases (`plugin.test.ts`), or two copies (a global bin beside a local install). No `globalThis` keys.

### Settings at build

- The plugin's `config` hook still loads `index.ts` with `runnerImport` to read `target` and `remote`, now from the registry.
- `dev build` does that for each of its builds (client, server, and prerender when on), and each evaluation resets itself.
- For the server bundle, a transform on `index.ts` drops the `bindings` property from the `config({ … })` call, and tree-shaking takes the function's dynamic imports (sqlite, local files) out of the Worker.
- Rule: import inside the function. App modules are not `sideEffects: false`, so a static import the stripped value used would stay. The build fails when it does, when `config`'s argument is not an object literal, and on an aliased, namespace or spread `config` it can't read. Alternative in open question 7.

### Generated entries

`/.expressive/server.ts` stays the one id; its load branches on dev or build, as it already branches on target.

**Fetch:**

```ts
import { compose } from "@expressive/dev/fetch";
import * as root from "../index.ts";   // registers; its default is the root gate
import * as s0 from "../app/remote.ts";
import * as a0 from "../api/photo/[id].ts";
export { Room } from "../index.ts";   // index.ts's named exports, as today
export default compose(root, [s0], manifest, [a0], apiManifest, pages);   // host's value, else { fetch(request, env, ctx) }
```

`/fetch`'s `compose` is `/server`'s with the tables and page patterns, built without Node imports.

**Node:** same imports. `listen({ root, client, sidecars, api, pages })` (today's `serve` in `/server`, renamed) composes and serves `app(request, { ctx, assets: dist/client })`, with the shell fallback above.

**Dev:** the plugin imports a virtual `/.expressive/server.ts`:

```ts
import * as root from "../index.ts";   // resets itself (prepended), then registers
import { compose } from "virtual:expressive/dev-compose";   // internal, not /server's
export default compose(root, { sidecars, api, pages, dev: true });   // read and seal
```

The tables are the same generated ones, so an `api/` file added regenerates this entry. Dev's `compose` adds its endpoints; it stays internal, and the public `compose(entry)` is the tests' form.

- Its middleware calls `app(request, { env: await bindings(), ctx, assets: public/ + Vite's shell })`, with `bindings` read from the same evaluation.
- An edit to `index.ts` or anything it imports invalidates the entry, so the next request re-evaluates both. An entry re-run alone (an `api/` table change) re-reads the registry `index.ts` left, which is still whole.
- Server patching in place (#745, #746) must treat `index.ts` as a re-evaluation boundary.

### Tests

```ts
import { compose } from "@expressive/dev/server";

const app = compose(await import("../index.ts"));
const page = await app(new Request("http://x/invite/abc"), { env, assets: { fetch: async () => new Response(shell) } });
```

Outside a build, no remotes or api routes are registered, so this tests the root gate's own logic (a sign-in link, a page rewrite) against a stubbed `assets`. Handlers read `Current`, so a route is tested through the app, not by calling its export. Vitest's default per-file isolation gives each test file one evaluation of `index.ts`. `vi.resetModules()` does not reset an externalised `/server`, so a second import in the same file throws "already set". Open question 6. The prepended reset imports from the entry-plumbing export above.

### `env`

`Current.get().env` reads what the host bound. Dev binds a layered view rather than the raw bindings:
- **Node and dev:** the request's bindings, then `process.env`, then `.env` files; the first that has a key wins.
- **Fetch target:** bindings, then `process.env` where defined. No file layer, so `node:fs`, `node:path` and `node:util` stay out of the bundle. The README's claim that it imports only `node:async_hooks` and `node:crypto` holds.

Outside a request (module scope, `scheduled`) there is no `Current`: handlers there take the platform's `env` argument, and Node code may use the root `env` (`@expressive/env`'s files-only reader shared with the client, unchanged). Reading `Current` there throws, and its message changes from "resolves only within a call" to "within a request".

## Migration

**Recommendation: break outright in 0.6.0 (`minor`), with no deprecated path.**

- `export default config({ port, remote })` dates to 0.1. `fetch`, `around`, `target` and `bindings` are in two published releases (0.4, 0.5). The only known consumer of the latter is on a pinned preview.
- A compatibility layer would keep the export-merging that this redesign exists to remove.
- The break is loud instead. An `index.ts` whose default export is an object or `config(...)` fails the dev server and the build: "`index.ts`'s default export is 0.5's config - call `config()` and `host()`, and default-export the root gate", with a link to the README section. Old keys passed to `config()` name their new home.

| 0.5 | 0.6 |
| --- | --- |
| `export default config({ port, target, remote })` | `config({ port, target, remote })` |
| `export async function bindings()` | `config({ bindings })` |
| `around: (next, { env }) => db.session(next, …)` | `export default () => { const { env, next } = Current.get(); return db.session(next, …) }` |
| `fetch(request, env, ctx, next)` answering paths | an `api/` route, or the root gate around `next()` |
| `fetch` returning nothing to fall through | the root gate finishing without a reply |
| `fetch` forwarding to `env.ASSETS` + shell fallback | nothing: `assets` defaults to `env.ASSETS` |
| `scheduled` (and other members) | `host`'s return value |
| `ctx.waitUntil(work)` in a handler | `send` the reply, then do the work; `Current.get().ctx` in calls and mounted handlers |
| `around`'s `scope.request`, `scope.env`, `scope.ctx` | `Current.get()`'s |
| `around` wrapping calls only (no `fetch`) | the root gate wraps pages and static files too |
| a throw in `fetch` reaching the host | a JSON reply (`HttpError`'s status, else 500) |
| `bindings` on the fetch target only, in dev | `config({ bindings })` on either target |
| `AppConfig`, `Scope` | `Settings`; `Scope` gone |
| `serve` from `/server` (generated entries only) | `listen` |
| `fetchHandler` from `/fetch` (generated entries only) | `compose` |

## Worked example

A Worker app: a database session per request on a D1 binding, an auth library, a dev-only sign-in link, a link-preview rewrite of one page, file routes and a cron. Under 0.5 it needed `around`, a path-matching `fetch`, its own `ASSETS`-plus-shell fallback, a `bindings` export and a pass-through `scheduled`.

It assumes the Worker runs before assets (`run_worker_first`). Otherwise the assets host answers `/?as=…` and, with single-page not-found handling, `/invite/:id` itself, and the sign-in link and the rewrite work in dev but not in production.

```ts
// index.ts
import { config, host, Current } from "@expressive/dev/server";
import type { Env } from "@expressive/rpc";

import { db, d1 } from "./server/db";
import { signInAs } from "./server/dev";
import { preview } from "./server/preview";
import { sweep } from "./server/jobs";

config({
  target: "fetch",
  remote: { opaque: false },
  bindings: async () => (await import("./db/bindings.ts")).bindings(),
});

host(() => ({
  scheduled(event: ScheduledController, bound: Env, ctx: ExecutionContext) {
    ctx.waitUntil(db.session(() => sweep(new Date(event.scheduledTime)), d1(bound.DB)));
  },
}));

export default () => {
  const { env, request, url, next } = Current.get();
  const dev = env.DEV_LOGIN === "1";

  return db.session(async () => {
    if (dev && url.searchParams.has("as")) {
      const signedIn = await signInAs(url);
      if (signedIn) return signedIn;
    }

    const page = await next();
    const invite = request.method === "GET" && page.ok && url.pathname.match(/^\/invite\/([^/]+)$/);

    return invite ? preview(page, decodeURIComponent(invite[1])) : page;
  }, d1(env.DB));
};
```

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
- **Dev-only routes are gated by their folder**, not a prefix rule in the root gate.
- **`host` holds only the cron.** The default `fetch` is added. The cron opens its own session, since it is not a request.
- **Moving routes under `/api` is a URL change for the app.** Two things need care:
  - OAuth redirect URIs registered with a provider: add the new one before the deploy and remove the old one after.
  - Persisted URLs, such as a stored `/photo/<id>`, need a data rewrite. The root gate can keep a 308 from the old prefix for a release, for cached pages and installed PWAs.

## Open questions

Each has a recommendation; sign-off on these unblocks PR 1 (question 11 is PR 1's mechanism).

1. **Where `config`, `host` and `compose` export from.** The original sketch imported from `@expressive/dev`'s root. `FEATURE.md`'s agreed shape puts server-only API (`config`, `Current`) in `@expressive/dev/server`, so a client import fails at build rather than at call. Recommend keeping that rule.
2. **Static sugar.** Recommend only `Current.send`, as `Cookies.set` is to `Cookies.get()`. Statics for `request`, `env` and the rest would duplicate the instance.
3. **Sending a Model instance.** Recommend throwing ("send its values") until Models have a defined JSON form.
4. **Migration.** Recommend the clean break.
5. **`api/` was already assigned.** `FEATURE.md`'s agreed shape has dev hosting rpc's call folder, `api/` by default: stubs on the client, no dynamic segments, one invocation path with sidecars (lines 22, 83, 185, and 302's "dev does not host an rpc `api/` folder yet"). HTTP routes at `api/` reverse that.
   - Recommend taking `api/` for HTTP routes, as chosen.
   - A direction to align with, undecided: `api/index.ts` alone may export call modules, which become public calls - the file route sets the URL, the exports set exposure - so one folder carries both lanes, and a client import of `api/index.ts` is a stub while a route file still fails. Its extra exports are reserved for that and fail the build until then.
   - `FEATURE.md` lines 22, 83, 185 and 302 get updated, along with 62 (the OAuth `api/` slice, now this) and 288 (REST verbs on a `Route` default). Line 233's "rpc folder, beyond calls" (REST verbs, the reply pipeline, OpenAPI) concerns rpc's external-client lane and stays. Line 21's Config line describes the new entry.
6. **A test reset.** Recommend none for now: one `index.ts` evaluation per test file. Per-test resets would need an exported `reset()`, which is new surface.
7. **`bindings` as a path.** `bindings: "./db/bindings.ts"`, a module only dev imports, needs no AST strip, no literal rule and no tree-shaking, at the cost of checking the module's default export only by its own `satisfies`. Recommend keeping the function (typed at the call) with the strict build rule; the path is the fallback if the transform turns out brittle.
8. **Body cap.** Recommend 1 MB by default, on `json()` and `text()` only, so calls and uploads keep today's behaviour. Raising it needs a setting (`config({ body: { limit } })`), which is new surface; recommend adding it only when asked.
9. **A throw below a wrapping gate.** Recommend resolving `next()` with the error reply, as calls already do, so a wrapper treats a failed call and a failed route alike. The alternative, rejecting `next()`, lets `db.session` roll back on a route's throw, but then calls would need to reject too to match.
10. **Trunk.** Recommend landing the PRs below on a `feat/dev-serve` trunk cut from this branch and releasing once. Publishing 0.6 with the root gate but without `api/` would make apps port twice. The trunk isn't released between PRs, so a gap one PR leaves for a later one is tolerated there (named below).
11. **Streams and scope.** A returned async generator settles its layer before its first pull, and a pull runs in the host's context. Recommend holding the request frame until the body closes or is cancelled, running each pull in the request's store, so `Session.get()` inside a generator works as it does in after-work. The alternative is to say stream producers run outside the scope and must capture what they need first.

## PR split

Each PR lands on the trunk with its own tests, a changeset where it is user-facing (`minor`), its README and skill section, and `hot-probe.ts` cases where it touches hot reload. In code, the layer and scope of this note take names distinct from `context.ts`'s `Layer` and `scope()`; gates build on its `gate()`.

1. **rpc: the request on `Current`, and gates with `next`.** One scope per request, gates' scopes enclosing what they pass to, optional `next` on function gates, `params`/`json()`/`text()`/`ctx`/`next`/`send` and static `send`, a gate's answers (`send`, a returned `Response` or function; other returns ignored), a returned function as a fetch handler, `next` waiting for the gate's Models, decided-reply timing, header joining per layer, the body rule with streams and cancellation, the body cache with call dispatch reading through it, a call's frame starting inside the request scope, the frame held for streams (question 11), after-work through `bind`'s `ctx`, the layer seam on `/protocol`, behaviour under `scoped()`.
2. **dev: registry and composition.** `config`/`host` with `host`'s default `fetch`, the root gate as `index.ts`'s default, `compose` and `listen`, the registry rules, generated entries, the chain for calls over today's page serving, sidecar call `params`, dev's skip list and fall-through, 101 passthrough, migration errors (the named `bindings` export and `export default config(...)` included). Updates the `FEATURE.md` lines in open question 5. Hot-probe: an `index.ts` edit resets the registry without a double-call throw and swaps the root gate. Gaps left on the trunk: the fetch target has no page fallback until PR 3, its bundle carries `bindings`' imports until PR 4, and an `api/` folder `index.ts` holding only a `default` is a catch-all from PR 5 until PR 6 makes it a gate.
3. **dev: pages over `assets`.** The one shell rule on every host (the page patterns in each entry, a navigation's 404 shell) and `assets` defaulting to `env.ASSETS`. Runtime check: a fetch-target build of the example app run under a local Workers runtime, plus Node.
4. **dev: build-only `bindings` and the layered `env`.** The transform dropping `bindings` and its build errors, the layered view dev binds, the fetch build's file-free reader, `.env` typing on rpc's `Env`. Tests prove the bundle carries neither the `bindings` imports nor `node:fs`.
5. **dev: `api/` routes.** Scan and strict matcher without backtracking, verbs, HEAD to GET, 404/405 with `Allow`, a `default` catch-all, the module-without-handler, naming and other-export errors, the `/api` reservations, the client import guard, generated tables and dev watch, the example app. Hot-probe: an `api/` edit.
6. **dev: `api/` gates.** A folder `index.ts`'s `default` as a gate over matched and unmatched paths with its folder's params, its Models in context until the request ends, and the class-default error.
7. **dev: gate check.** The scan marking gated folders and the generated tree wrapping their `enter`, the rule for when a check is sent, the `x-expressive-get` branch answering `200 {}` after the gates, refusal through the codec to `Catch` with retry re-sending, redirects (router or `location.assign`, a 3xx `Response` mapped, no loops), superseded checks, prerender exclusion, clearing passes on a gate edit, the example's `enter` check replaced. Needs the twins-removal PR's function gates, and folder gates running on the fetch target for it to fire there: lifting that refusal is its own PR before this one. Runtime: an example e2e spec (one check on entry, none inside the folder, one on a param change, refusal to `Catch`, redirect, zero requests in a gate-less app, a superseded navigation) under dev and the Node build, and a `hot-probe.ts` case for a gate edit.

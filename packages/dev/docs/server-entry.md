# The server entry as calls

Design note for reshaping `@expressive/dev`'s server entry, for sign-off before any implementation. Once agreed, the root `FEATURE.md` takes its outcome (lines superseded: open question 5), and this file goes when the work lands.

## Why

0.5's `index.ts` default-exports `config({ port, target, remote, fetch, around, scheduled })`, and a named `bindings` export supplies dev's `env`. That shape has three problems:

- `fetch` reads as outbound. It is really a catch-all for requests that are not calls, so it overlaps `around`, which wraps the same requests.
- Unknown members (`scheduled`) pass through into the Worker's default export untyped. Any platform handler dev doesn't know about rides along by accident.
- Pages and static files are the app's job on the fetch target: an app carries its own `ASSETS`-plus-shell fallback, and a page rewrite built on it doesn't run in dev.

`fetch`, `around`, `target` and `bindings` shipped in 0.4.0 (#774, #777). `next()` followed in 0.5.0 (#794). Both releases are on npm. Neither has a known consumer outside a pinned preview build.

## Settled in review

- **Handlers take no parameters.** `serve`, `api/` routes and gates read the request from `Current.get()`, so nothing needs a hand-typed `(request: Request, …)`.
- **`Current` carries the request and the reply:** `params`, `json()`, `text()`, `next` and `send` join `request`, `url`, `cookies`, `env` and `setHeader`.
- **`send`, not a returned `Response`.** Code after `send` is after-work, which replaces `ctx.waitUntil`, an `after()` helper and a generator protocol. A returned value or `Response` still works.
- **`api/` gates are rpc's function gates.** A folder `index.ts`'s `default` runs before everything below it and refuses by throwing or by a failed `new()` of a Model it activates; those Models are in context below. Elsewhere `default` is a catch-all. No remainder export (`ANY`, `ELSE`).
- **An object sent or returned goes as JSON.**
- **`assets` defaults to `env.ASSETS` on the fetch target.**

## Shape

`index.ts` calls three functions at its top level. It exports nothing for dev to read.

```ts
import { config, serve, host, Current } from "@expressive/dev/server";   // see open question 1
import type { Env } from "@expressive/rpc";

config({ target: "fetch", remote: { opaque: false }, bindings: async () => (await import("./dev-env")).bindings() });

serve(() => {
  const { env, next } = Current.get();
  return db.session(next, d1(env.DB));
});

host(() => ({
  scheduled: (event: ScheduledController, bound: Env) => db.session(() => sweep(), d1(bound.DB)),
}) satisfies ExportedHandler<Env>);
```

### Types

```ts
// @expressive/dev/server
export interface Settings {
  /** Default "node": a server on `port` serving dist/client. "fetch": a bundled module exporting `host`'s value, else `{ fetch(request, env, ctx) }` over `app`. */
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
  /** Where after-work goes. Default: a stand-in that runs it and logs a rejection. */
  ctx?: { waitUntil(promise: Promise<unknown>): void };
  /** Serves pages and static files - `next()` falls back on it. Default on the fetch target: `env.ASSETS`. */
  assets?: { fetch(request: Request): Promise<Response> };
}

/** The composed app: `serve`'s handler around calls, api routes and pages. */
export type App = (request: Request, options?: AppOptions) => Promise<Response>;

export function config(settings: Settings): void;
export function serve(handler: () => unknown): void;
export function host<T>(build: (app: App) => T): void;

/** Test seam: the app composed from what is registered, sealed on first call. */
export const app: App;
```

```ts
// @expressive/rpc - additions to Current
class Current {
  /** The matched api route's params, decoded; a `[...]` segment under "*". `{}` elsewhere. */
  get params(): Record<string, string>;
  /** The request body as JSON; `undefined` when empty. Rejects with `BadRequest` on invalid JSON or another content type. */
  json(): Promise<unknown>;
  /** The request body as JSON, passed through `check`. A throw from it rejects with `BadRequest` carrying its message; an `HttpError` keeps its status. */
  json<T>(check: (value: unknown) => T): Promise<T>;
  /** The request body as a string. */
  text(): Promise<string>;
  /** What `serve`'s handler wraps. Calling it anywhere else throws; reading it never does. */
  get next(): () => Promise<Response>;

  /** Decide this layer's reply. Resolves once the reply is handed to the host; code after it is after-work. */
  send(body?: unknown): Promise<void>;
  send(status: number, body?: unknown): Promise<void>;
  send(response: Response): Promise<void>;
  static send(body?: unknown): Promise<void>;
  static send(status: number, body?: unknown): Promise<void>;
  static send(response: Response): Promise<void>;
}

export function bind(request: Request, env: Env, ctx?: { waitUntil(promise: Promise<unknown>): void }): void;
```

The new getters keep a throwing setter, as `Current`'s do today, so mvc leaves them uncomputed (it skips a getter that has a setter). `json` and `text` are methods, mirroring `Request`'s, and mvc binds them, so they destructure. Form data and bytes come from `request` itself (`await request.formData()`), which reads the same cache.

`send`'s first argument: a number is a status, a `Response` is the whole reply, anything else is the body. A number as the body needs a status: `send(200, 42)`.

`@expressive/rpc/protocol` (host plumbing, beside `within`) gains the layer seam dev composes with: run a handler with a given `next` and `params` in the request's scope, and resolve with its reply. Under rpc's own `scoped()` and `handler()`, the wrapped `fetch` is one such layer: `send`, `json` and `text` work, `params` is `{}`, and calling `next` throws.

New public surface for sign-off (AGENTS.md):
- **dev `/server`:** `config`, `serve`, `host`, `app`, and the types `Settings`, `AppOptions`, `App`. `Current` is already re-exported there.
- **rpc `Current`:** `params`, `json`, `text`, `next`, `send` and static `send`; `bind`'s `ctx`.

Removed or renamed: `AppConfig` → `Settings`, `Scope` (gone), `serve` → `listen` (the Node listener the generated entry calls), `@expressive/dev/fetch`'s `fetchHandler` → the entry's composer, and the plugin API `Host.config()` returns `Settings`. Entry plumbing (`listen`, the composers) stays on `/server` and `/fetch` as today, documented as not app API.

`Env` is still augmented where `Current.get().env` reads it: `declare module "@expressive/rpc" { interface Env { … } }`. The `.env` typing `@expressive/env` generates augments rpc's `Env` as well when dev is installed, so `Current.get().env` types both layers.

### Semantics

- **`config`** holds build and run settings. Dev reads them while Vite configures. Only `bindings` leaves the bundle (below); Node's entry needs `port` at runtime.
- **`serve(handler)`** wraps every request the host forwards: remote calls, twin streams, `/api/*`, and pages and static files. A host that answers static files itself first (Workers assets without `run_worker_first`) never forwards those, so a gate in `serve` does not cover them. It replaces both `fetch` and `around`, and absorbs #794's `next()`.
  - Without `serve`, the app is `next`.
  - A 101 (WebSocket upgrade) passes through unjoined, since rebuilding it drops the socket.
- **`host(build)`** is optional, and only for the fetch target. It gets the composed `app`, and its return value becomes the bundle's default export.
  - Without it, the default export is `{ fetch: (request, env, ctx) => app(request, { env, ctx }) }`. A returned object without `fetch` gets that one, so `host` is only needed for what dev doesn't model.
  - Platform handlers (`scheduled`, `queue`, `email`) are the app's code, typed by the app: `satisfies ExportedHandler<Env>`. They run outside any request, so they read the platform's `env` argument, not `Current`.
  - Dev never calls `build`, so there is no cron in dev, as today.
  - On the Node target, `host` fails the build and the dev server. Node has no module host to hand an export to.
- **`index.ts`'s named exports** are still re-exported from the fetch bundle (Durable Object and Workflow classes). There is no `bindings` exception anymore.
- **`index.ts` is still optional.** Without it there are no settings, the app is `next`, and the export is the default above.

### The request on `Current`

Every forwarded request runs in one request scope, so `Current`, `Cookies` and `get(Model)` work in `serve`, gates and routes as they do in calls. Each layer (`serve`, then the route) runs in a nested scope, so `next` and `params` are that layer's. `api/` gates run between them, in the route's scope. Destructuring captures them when read.

**A layer's reply is decided** by its first of:
- **`send(...)`.** The function keeps running.
- **Returning.** A `Response` as is; any other value as a body by the rule below, status 200. `undefined` passes through what `next()` answered when it was called. Otherwise `undefined` is 204 from a verb or catch-all, and an error from `serve` ("`serve` returned nothing - return `next()`"), so a forgotten `return next()` can't blank the app.
- **Throwing.** On a call request, a throw replies as a call's error would, so a gate can throw `Unauthorized` and keep its class. Elsewhere an `HttpError` answers its status with a JSON `{ message }` (`Redirect` sets `Location`), and anything else is a 500 whose message shows in dev only, logged (today Node answers a bare 400).

`next()` resolves with the lower layer's reply once that is decided, not when its function finishes. A lower layer's throw resolves `next()` with its error reply rather than rejecting, as a call's error does today, so `db.session(next)` sees the same thing from a failed call and a failed route (open question 9). A second `next()` throws.

**The reply leaves** when the outermost layer's reply is decided. `send` resolves then: on hand-off to the host, not when the body drains. It also resolves when an upper layer swapped the reply or threw, and when the client aborts, so after-work never hangs.

**After a decided reply**, a second `send`, a return value other than `undefined` (dev warning), or `setHeader`/`Cookies.set` throws. Awaiting `next()` decides nothing, so a wrapping layer can still reply with what it got and keep working:

```ts
serve(async () => {
  const { next, send } = Current.get();
  const reply = await next();
  await send(reply);
  await log(reply.status);   // after-work
});
```

**After-work.** Code after `send` runs once the reply has left. On the fetch target, the rest of the layer's promise goes to the host's `ctx.waitUntil`; on Node and in dev it just runs. A throw there is logged. The layer's own scope stays open until its function settles, so `Current`, `Cookies` and `get(Model)` still work, but every layer above has returned: a wrapper like `db.session(next)` has closed, so after-work and a lazily produced stream body open their own session. rpc's request frame (held seats, gated Models) is released once every layer has settled.

**Headers.** `setHeader` and `Cookies` join the reply of the layer that set them, when that reply is decided, so the `Response` `next()` resolves with already carries them. A layer that swaps the reply starts from the new one's headers. Order, lowest first: the body rule's content type, `setHeader`, a `Response`'s own headers (as `withHeaders` does today). The cookie flush re-arms per layer, so `Session.set()` after `await next()` reaches the outer reply.

**`send`'s body rule**, shared with return values:
- plain objects, arrays, numbers, booleans and `null`: JSON, honouring `toJSON`. `Map`, `Set`, `bigint` and a Model instance throw ("send its values").
- a string: `text/plain`;
- `ArrayBuffer`, typed arrays, `DataView`, `Blob`, `FormData`, `URLSearchParams`, `ReadableStream`: as `Response` takes them;
- any other async iterable of strings or bytes (a Node `Readable`, an async generator): streamed through `ReadableStream.from`, or a small wrapper where a runtime lacks it;
- no body: 204 unless a status is given. Status otherwise defaults to 200. A body with 204, 304 or a 1xx status throws.

**Streaming and pipes** use the platform's streams rather than a `write`/`end` API:

```ts
await send(200, (await fetch(upstream)).body);                              // proxy a body
await send(200, file.stream().pipeThrough(new CompressionStream("gzip")));  // transform
await send(200, createReadStream(path));                                    // a Node Readable is an async iterable

const { readable, writable } = new TransformStream();                       // push-style
await send(200, readable);                                                  // resolves at hand-off
await source.pipeTo(writable);
```

A throw mid-stream aborts the body and is logged; the status can't change by then. A reply an upper layer swapped or discarded has its body cancelled, and so does a HEAD reply's, so an upstream body never stalls. On Node and in dev, a JSON reply is buffered; a streamed one sets another type through `setHeader` (`application/x-ndjson`).

**Body.** Nothing is read until `json()` or `text()` is called, so answering early leaves no rejected promise behind. The first read buffers the raw bytes once, up to a cap (413 `PayloadTooLarge` past it, open question 8); every later read, including `request.formData()` and `request.arrayBuffer()`, derives from them. From then on, `Current.get().request` and the request `next()` forwards are rebuilt over those bytes, and call dispatch reads its arguments through the cache, so a `serve` that checks a signature leaves calls, catch-alls, `assets` and dev's fall-through intact. Unhandled, `json()`'s `BadRequest` answers 400.

**Validation.** `json(check)` infers `T` from the check, so a library's throwing parse types the body with no generic: `await json(Item.parse)` (zod), `await json(Event.assert)` (arktype), `await json(v => parse(User, v))` (valibot). There is no `json<T>()` without a check: it would be a cast that reads as validation. `(value: unknown) => T` is the one validation contract: rpc's call arguments reuse it later, whether the check is hand-written or generated from a call's parameter types by a build transform, which would also fill `json<T>()`.

**Inside a call**, calling `next` or `send`, `json` or `text`, throws: a call replies with its return value through rpc's codec. Reading them doesn't, so a shared helper can destructure `Current.get()`.

### What `next()` resolves, in order

1. **Remote call** (`isCall`, including `POST /.expressive/detached`): dispatch to the sidecar. A missing call is a JSON 404, as today.
2. **Twin stream** (`GET /.expressive/stream`, Node and dev): the stream. The fetch target refuses seats and twins, so it has none.
3. **`/api/*`**: the folder's gates, then the matching `api/` route. An unmatched path is a JSON 404 and never the shell.
4. **Pages and static files**: the file, else `<path>/index.html`, else the shell, else 404. One shell rule on every host: only for GET or HEAD, only for a path some page route matches, and never under the build's `assetsDir`, so a stale chunk stays a 404 instead of becoming HTML with the wrong MIME type. (Node today falls back for any method and path; this narrows it.)
   - **Node:** from `dist/client`, with the `assetsDir` cached immutable. The shell is `200.html`, else `index.html`.
   - **Dev:** a `public/` file, else the shell as Vite transforms it. Anything else falls through to Vite's middleware stack (below).
   - **Fetch target:** `assets.fetch(request)`; on a 404 that the shell rule covers, `assets.fetch` gets `/200.html` and then `/index.html`, keeping the method and following one same-origin redirect (an asset host that serves pretty URLs redirects these). This replaces the fallback each Workers app hand-writes today. `assets` defaults to `env.ASSETS` when that binding has a `fetch`; without either, the answer is 404.

`assets` is otherwise written by hand only in tests (a stubbed shell) and for files kept elsewhere: `assets: { fetch: r => fetch(new URL(new URL(r.url).pathname, origin)) }`.

**Twin streams go through `serve`.** Today they skip `around`. Passing them through keeps "every request" literal, and it lets a gate refuse a stream (a banned or signed-out tab) before it opens. The cost is one middleware pass per stream (re)connect. Frames on an open stream come from calls, which each run their own `serve`.

**Seats are untouched.** A seat is built and used inside calls, so each method call runs inside `serve`. A seat outlives any one request's scope (`ttl`), so it must not hold a per-request session. That was already true under `around`.

**In dev, `serve` sees what production would, and Vite keeps the rest.**
- Calls and `/api/*` are decided first, so they always go through `serve` and gates.
- Vite's own URLs then skip `serve`: paths outside `base`, `/@vite/*`, `/@id/*`, `/@fs/*`, `/node_modules/*`, `/.expressive/*` other than calls and the stream, the bare `?import`, `?url` and `?raw` flags (`?url=https://…` is not one), and paths naming a source file under the root outside `public/` and `api/`. Today `fetch` and `around` see them, which the README warns about.
- The page step must not starve later middlewares: inspect's `/__inspect` relay, other plugins' middlewares, `server.proxy`, `/__open-in-editor`. When `next()` found no `public/` file and the request is not a navigation (its `accept` lacks `text/html`), it resolves a marked 404. If the reply is that response untouched, the middleware hands the request to Vite's stack instead, without the headers `serve` set. The mark survives header joining.

## `api/`: routes by location

A root `api/` folder sits beside `app/` and is served under a fixed `/api` prefix. It uses `app/`'s path syntax for segments: `api/photo/[id].ts` serves `/api/photo/:id`, `api/auth/[...].ts` serves `/api/auth/*` (one segment or more), and `api/index.ts` serves `/api`.

**Location makes a route, never its exports.** Every `.ts`, `.tsx`, `.js` or `.jsx` module under `api/` is a route, except `*.test.*`, `*.spec.*` and `.d.ts`. Unlike `app/`, a bare name is a route (`api/logout.ts` serves `/api/logout`), since `api/` holds no support modules; helpers live outside it, in `server/` for example. A `(name).ts` file, and `api/dev.ts` beside `api/dev/index.ts`, fail the build.

**Exports:**
- **`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`** answer that method on the module's own path. HEAD falls to GET, the host cancels the body, and `Allow` lists HEAD wherever GET is exported.
- **`default` in a folder's `index.ts` is the folder's gate**, as rpc's function gates are (`@expressive/rpc`'s "Function gates"), run on the same code path. It runs before every route in the folder and below, its own verbs included, root first, and for unmatched paths there too, so a refused caller gets the same answer for a route that exists and one that doesn't.
  - It refuses by throwing (an `HttpError` answers its status) or by activating a Model whose `new()` fails, with that Model's error.
  - Every Model it activates is the request's own: found by `X.get()` in inner gates and routes, waited on until ready, destroyed when the request ends (after-work included).
  - It returns nothing; finishing is passing. Headers and cookies it sets join the reply.
  - A class `default` fails the build: a function that activates the Model covers it, per request.
- **`default` in any other module is a catch-all**: it answers every method on its path. Beside verbs it fails the build.
- **Any other runtime export fails the build**, so `export const Get` or a stray helper is caught rather than ignored. Type exports are fine. `api/index.ts`'s are reserved (open question 5).
- A module with neither verbs nor a catch-all fails the build and the dev server, except a folder `index.ts` with only a gate.

The chain for `/api/account/me`: `serve` → `api/index.ts`'s gate → `api/account/index.ts`'s gate → `api/account/me.ts`'s verb or catch-all. Gates see the full match's `params`. Past the gates: a path no module matches is a 404, a module with no handler for its own path is a 404, and a module whose verbs don't include the method is a 405 with `Allow`.

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

Why gates by folder: a gate belongs to the routes it covers, so the gate and the matched path can't disagree (`/api/DEV/mail` against a string compare in `serve`), and moving a folder moves its gate. Sharing rpc's gate model gives calls, sidecars and HTTP routes one rule for access and one for what a route finds in context.

**Other rules:**

- Matching is exact and case-sensitive, on raw segments of the path `serve` sees; params are decoded after the match. A malformed `%` escape is a 400, and an empty segment (`//`) never matches. That rules out the router's client matcher (`url.ts` lowercases literals and trims slashes); the api table gets a strict one. Precedence follows the page tree's sort (`routes.ts`): fixed, then `:param`, then `*`.
- `api/` is server-only. A client module importing from it fails the build, as it would for another folder's sidecar.
- When a root `api/` exists, `app/api/`, `app/api.tsx`, `app/(api).tsx` and `public/api/` fail the dev server and the build, because `/api` belongs to the folder. A root `[slug]` page can't be reached at `/api` either, and the 404 there says so. Without `api/`, an app may still own `/api` itself.
- `api/` routes are not prerendered.

## Mechanics

### Registry

A module in dev, shared through one tsdown chunk by `dist/server/*` and `dist/fetch.js`, holds `{ settings?, handler?, build?, sealed }`.

- **Once per evaluation.** `config`, `serve` and `host` each set their slot. A second call to the same one throws: "`serve()` is already set - call it once, at `index.ts`'s top level."
- **Old keys throw too.** `config` rejects unknown keys by name, the 0.5 ones included: "`fetch` and `around` moved to `serve()` …". This is the migration error.
- **Sealed when composed.** The generated entry composes the app from the registry and then seals it; so does the first call to `app`. A call after that throws: "`config()` ran after the app was composed - call it at `index.ts`'s top level, not after an await or in a callback". That covers `target` being set after dev read it.
- **Reset when `index.ts` evaluates, and only then.** The plugin's transform prepends the reset to `index.ts` itself. Tying it to the entry would fail two ways. An entry re-run with `index.ts` cached (an `api/` file added regenerates the table) would reset and re-register nothing, silently dropping the gate. An `index.ts` patched in place would throw "after composed".
- **The plugin never imports the registry.** It reads settings through a module evaluated on the same runner as `index.ts`: the virtual entry in dev, and at build an inline-plugin virtual module passed to `runnerImport`. One instance then holds whatever resolves `@expressive/dev`: an installed package, the suite's `src` aliases (`plugin.test.ts`), or two copies (a global bin beside a local install). No `globalThis` keys.

### Settings at build

- The plugin's `config` hook still loads `index.ts` with `runnerImport` to read `target` and `remote`, now from the registry.
- `dev build` does that for each of its builds (client, server, and prerender when on), and each evaluation resets itself.
- For the server bundle, a transform on `index.ts` drops the `bindings` property from the `config({ … })` call, and tree-shaking takes the function's dynamic imports (sqlite, local files) out of the Worker.
- Rule: import inside the function. App modules are not `sideEffects: false`, so a static import the stripped value used would stay. The build fails when it does, when `config`'s argument is not an object literal, and on an aliased, namespace or spread `config` it can't read. Alternative in open question 7.

### Generated entries

The plugin builds each entry from the registry rather than from a default export. `/.expressive/server.ts` stays the one id; its load branches on dev or build, as it already branches on target.

**Fetch:**

```ts
import { compose } from "@expressive/dev/fetch";
import "../index.ts";                  // registers; static import evaluates first
import * as s0 from "../app/remote.ts";
import * as a0 from "../api/photo/[id].ts";
export { Room } from "../index.ts";   // index.ts's named exports, as today
export default compose([s0], manifest, [a0], apiManifest);   // host's value, else { fetch(request, env, ctx) }
```

**Node:** same imports. `listen({ client, sidecars, seats, api })` (today's `serve` in `/server`, renamed) composes and serves `app(request, { ctx, assets: dist/client })`, with the shell fallback above.

**Dev:** the plugin imports a virtual `/.expressive/server.ts`:

```ts
import "../index.ts";   // resets itself (prepended), then registers
import { composed } from "@expressive/dev/server";
export default composed();   // read and seal
```

- Its middleware calls `app(request, { env: await bindings(), ctx, assets: public/ + Vite's shell })`, with `bindings` read from the same evaluation.
- An edit to `index.ts` or anything it imports invalidates the entry, so the next request re-evaluates both. An entry re-run alone (an `api/` table change) re-reads the registry `index.ts` left, which is still whole.
- Server patching in place (#745, #746) must treat `index.ts` as a re-evaluation boundary.

### Tests

`@expressive/dev/server` exports `app: App`, composed from whatever is registered:

```ts
import "../index.ts";
import { app } from "@expressive/dev/server";

const page = await app(new Request("http://x/invite/abc"), { env, assets: { fetch: async () => new Response(shell) } });
```

Outside a build, no remotes or api routes are registered, so this tests `serve`'s own logic (a sign-in link, a page rewrite) against a stubbed `assets`. Handlers read `Current`, so a route is tested through `app`, not by calling its export. Vitest's default per-file isolation gives each test file one evaluation of `index.ts`. `vi.resetModules()` does not reset an externalised `/server`, so a second import in the same file throws "already set". Open question 6.

### `env`

`Current.get().env` reads what the host bound. Dev binds a layered view rather than the raw bindings:
- **Node and dev:** the request's bindings, then `process.env`, then `.env` files.
- **Fetch target:** bindings, then `process.env` where defined. No file layer, so `node:fs`, `node:path` and `node:util` stay out of the bundle. The README's claim that it imports only `node:async_hooks` and `node:crypto` holds.

Outside a request (module scope, `scheduled`) there is no `Current`: handlers there take the platform's `env` argument, and Node code may use the root `env` (`@expressive/env`'s files-only reader shared with the client, unchanged). Reading `Current` there throws, and its message changes from "resolves only within a call" to "within a request".

## Migration

**Recommendation: break outright in 0.6.0 (`minor`), with no deprecated path.**

- `export default config({ port, remote })` dates to 0.1. `fetch`, `around`, `target` and `bindings` are in two published releases (0.4, 0.5). The only known consumer of the latter is on a pinned preview.
- A compatibility layer would keep the export-merging that this redesign exists to remove.
- The break is loud instead. An `index.ts` with a default export fails the dev server and the build: "`index.ts`'s default export is 0.5's config - call `config()`, `serve()` and `host()` instead", with a link to the README section. Old keys passed to `config()` name their new home.

| 0.5 | 0.6 |
| --- | --- |
| `export default config({ port, target, remote })` | `config({ port, target, remote })` |
| `export async function bindings()` | `config({ bindings })` |
| `around: (next, { env }) => db.session(next, …)` | `serve(() => { const { env, next } = Current.get(); return db.session(next, …) })` |
| `fetch(request, env, ctx, next)` answering paths | an `api/` route, or `serve` around `next()` |
| `fetch` returning nothing to fall through | `return next()` - returning nothing from `serve` is an error |
| `fetch` forwarding to `env.ASSETS` + shell fallback | nothing: `assets` defaults to `env.ASSETS` |
| `scheduled` (and other members) | `host`'s return value |
| `ctx.waitUntil(work)` in a handler | `send` the reply, then do the work |
| `AppConfig`, `Scope` | `Settings`; `Scope` gone |
| `serve` from `/server` (generated entries only) | `listen` |
| `fetchHandler` from `/fetch` (generated entries only) | the entry's composer |

## Worked example

A Worker app: a database session per request on a D1 binding, an auth library, a dev-only sign-in link, a link-preview rewrite of one page, file routes and a cron. Under 0.5 it needed `around`, a path-matching `fetch`, its own `ASSETS`-plus-shell fallback, a `bindings` export and a pass-through `scheduled`.

It assumes the Worker runs before assets (`run_worker_first`). Otherwise the assets host answers `/?as=…` and, with single-page not-found handling, `/invite/:id` itself, and the sign-in link and the rewrite work in dev but not in production.

```ts
// index.ts
import { config, host, serve, Current } from "@expressive/dev/server";
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

serve(() => {
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
});

host(() => ({
  scheduled(event: ScheduledController, bound: Env, ctx: ExecutionContext) {
    ctx.waitUntil(db.session(() => sweep(new Date(event.scheduledTime)), d1(bound.DB)));
  },
}) satisfies ExportedHandler<Env>);
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
- **Dev-only routes are gated by their folder**, not a prefix rule in `serve`.
- **`host` holds only the cron.** The default `fetch` is added. The cron opens its own session, since it is not a request.
- **Moving routes under `/api` is a URL change for the app.** Two things need care:
  - OAuth redirect URIs registered with a provider: add the new one before the deploy and remove the old one after.
  - Persisted URLs, such as a stored `/photo/<id>`, need a data rewrite. `serve` can keep a 308 from the old prefix for a release, for cached pages and installed PWAs.

## Open questions

Each has a recommendation; sign-off on these unblocks PR 1.

1. **Where the three functions export from.** The original sketch imported them from `@expressive/dev`'s root. `FEATURE.md`'s agreed shape puts server-only API (`config`, `serve`, `Current`) in `@expressive/dev/server`, so a client import fails at build rather than at call. Recommend keeping that rule.
2. **Static sugar.** Recommend only `Current.send`, as `Cookies.set` is to `Cookies.get()`. Statics for `request`, `env` and the rest would duplicate the instance.
3. **Sending a Model instance.** Recommend throwing ("send its values") until Models have a defined JSON form.
4. **Migration.** Recommend the clean break.
5. **`api/` was already assigned.** `FEATURE.md`'s agreed shape has dev hosting rpc's call folder, `api/` by default: stubs on the client, no dynamic segments, one invocation path with sidecars (lines 22, 83, 185, and 302's "dev does not host an rpc `api/` folder yet"). HTTP routes at `api/` reverse that.
   - Recommend taking `api/` for HTTP routes, as chosen.
   - A direction to align with, undecided: `api/index.ts` alone may export call modules, which become public calls - the file route sets the URL, the exports set exposure - so one folder carries both lanes, and a client import of `api/index.ts` is a stub while a route file still fails. Its extra exports are reserved for that and fail the build until then.
   - `FEATURE.md` lines 22, 83, 185 and 302 get updated, along with 62 (the OAuth `api/` slice, now this) and 288 (REST verbs on a `Route` default). Line 233's "rpc folder, beyond calls" (REST verbs, the reply pipeline, OpenAPI) concerns rpc's external-client lane and stays.
6. **A test reset.** Recommend none for now: one `index.ts` evaluation per test file. Per-test resets would need an exported `reset()`, which is new surface.
7. **`bindings` as a path.** `bindings: "./db/bindings.ts"`, a module only dev imports, needs no AST strip, no literal rule and no tree-shaking, at the cost of checking the module's default export only by its own `satisfies`. Recommend keeping the function (typed at the call) with the strict build rule; the path is the fallback if the transform turns out brittle.
8. **Body cap.** Recommend 1 MB by default. Raising it needs a setting (`config({ body: { limit } })`), which is new surface; recommend adding it only when asked.
9. **A lower layer's throw.** Recommend resolving `next()` with the error reply, as calls already do, so a wrapper treats a failed call and a failed route alike. The alternative, rejecting `next()`, lets `db.session` roll back on a route's throw, but then calls would need to reject too to match.
10. **Trunk.** Recommend landing the PRs below on a `feat/dev-serve` trunk cut from this branch and releasing once. Publishing 0.6 with `serve` but without `api/` would make apps port twice. The trunk isn't released between PRs, so a gap one PR leaves for a later one is tolerated there (named below).

## PR split

Each PR lands on the trunk with its own tests, a changeset where it is user-facing (`minor`), its README and skill section, and `hot-probe.ts` cases where it touches hot reload. In code, the layer and scope of this note take names distinct from `context.ts`'s `Layer` and `scope()`; `api/` gates reuse its `gate()`.

1. **rpc: the request on `Current`.** One scope per request, nested layers, `params`/`json()`/`text()`/`next`/`send` and static `send`, decided-reply timing, header joining per layer, the body rule with streams and cancellation, the body cache with call dispatch reading through it, after-work through `bind`'s `ctx`, the layer seam on `/protocol`, behaviour under `scoped()`/`handler()`.
2. **dev: registry and composition.** `config`/`serve`/`host` with `host`'s default `fetch`, `App`, the registry rules, `/server`'s `app` and `listen`, generated entries importing `index.ts`, the `next()` order for calls and streams over today's page serving, dev's skip list and fall-through, 101 passthrough, migration errors. Updates the `FEATURE.md` lines in open question 5. Hot-probe: an `index.ts` edit resets the registry without a double-call throw. Gaps left on the trunk: the fetch target has no page fallback until PR 3, and its bundle carries `bindings`' imports until PR 4.
3. **dev: pages over `assets`.** The one shell rule on every host and `assets` defaulting to `env.ASSETS`. Runtime check: a fetch-target build of the example app run under a local Workers runtime, plus Node.
4. **dev: build-only `bindings` and the layered `env`.** The transform dropping `bindings` and its build errors, the layered view dev binds, the fetch build's file-free reader, `.env` typing on rpc's `Env`. Tests prove the bundle carries neither the `bindings` imports nor `node:fs`.
5. **dev: `api/` routes.** Scan and strict matcher, verbs, HEAD to GET, 404/405 with `Allow`, a `default` catch-all, the module-without-handler, naming and other-export errors, the `/api` reservations, the client import guard, generated tables and dev watch, the example app. Hot-probe: an `api/` edit.
6. **dev: `api/` gates.** A folder `index.ts`'s `default` on rpc's function-gate path, over matched and unmatched paths, its Models in context until the request ends, and the class-default error.

# The server entry as calls

Design note for reshaping `@expressive/dev`'s server entry, for sign-off before any implementation. Once agreed, the root `FEATURE.md`'s **Config** line takes its outcome, and this file goes when the work lands.

## Why

0.5's `index.ts` default-exports `config({ port, target, remote, fetch, around, scheduled })`, and a named `bindings` export supplies dev's `env`. That shape has three problems:

- `fetch` reads as outbound. It is really a catch-all for requests that are not calls, so it overlaps `around`, which wraps the same requests.
- Unknown members (`scheduled`) pass through into the Worker's default export untyped. Any platform handler dev doesn't know about rides along by accident.
- Pages and static files are the app's job on the fetch target: an app carries its own `ASSETS`-plus-shell fallback, and a page rewrite built on it doesn't run in dev.

0.5.0 is already published with `next()` (#794, #796) and `around`. Neither has a known consumer outside a pinned preview build.

## Shape

`index.ts` calls three functions at its top level. It exports nothing for dev to read.

```ts
import { config, serve, host, env } from "@expressive/dev/server";   // see open question 1

config({ target: "fetch", remote: { opaque: false }, bindings: async () => (await import("./dev-env")).bindings() });

serve(async (request, next) => db.session(next, d1(env.DB)));

host(app => ({
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app(request, { env, ctx, assets: env.ASSETS }),
  scheduled: (event: ScheduledController, env: Env) => db.session(() => sweep(), d1(env.DB)),
}) satisfies ExportedHandler<Env>);
```

### Types

```ts
// @expressive/dev/server
export interface Settings {
  /** Default "node": a server on `port` serving dist/client. "fetch": a bundled module exporting `host`'s value, else `{ fetch: app }`. */
  target?: "node" | "fetch";
  /** Node and dev only. Default 3000 in production, Vite's in dev. `--port` wins. */
  port?: number;
  remote?: { opaque?: boolean };
  /** Dev's per-request bindings (`env`), built once per server and again after a throw. The build drops it. */
  bindings?(): Partial<Env> | Promise<Partial<Env>>;
}

/** What `next()` would answer: the call, the stream, the api route or the page. */
export type Next = () => Promise<Response>;

export type Handler = (request: Request, next: Next, ctx: Ctx) => Response | Promise<Response>;

export interface Ctx { waitUntil(promise: Promise<unknown>): void }

export interface AppOptions {
  /** This request's bindings: `env` and `Current.get().env`. Default `{}`. */
  env?: Env;
  /** Default: a stand-in whose `waitUntil` logs a rejection. */
  ctx?: Ctx;
  /** Serves pages and static files - `next()` falls back on it. Without it, `next()` answers those with 404. */
  assets?: { fetch(request: Request): Promise<Response> };
}

/** The composed app: `serve`'s handler around calls, api routes and pages. */
export type App = (request: Request, options?: AppOptions) => Promise<Response>;

export function config(settings: Settings): void;
export function serve(handler: Handler): void;
export function host<T>(build: (app: App) => T): void;

/** The request's bindings, then `.env` files / `process.env`. */
export const env: Readonly<Env>;
```

`Env` is still augmented where `Current.get().env` reads it: `declare module "@expressive/rpc" { interface Env { … } }`.

### Semantics

- **`config`** holds build and run settings. Dev reads them while Vite configures, and they stay out of the bundle (below).
- **`serve(handler)`** wraps every request: remote calls, twin streams, `/api/*`, and pages and static files. It replaces both `fetch` and `around`, and absorbs #794's `next()`.
  - Without `serve`, the app is `next`.
  - The handler runs in the request's scope, so `Current`, `Cookies` and `env` work. Headers and cookies it sets join the reply, including a call's reply.
  - The scope ends when the handler resolves. A streamed body and `waitUntil` work run after that, as with `around` today.
  - On a call request, a throw from the handler replies as a call's error would, so a gate can throw `Unauthorized` and keep its class. On any other request the throw reaches the host.
  - A body read before `next()` is gone - read a `clone()`.
- **`host(build)`** is optional, and only for the fetch target. It gets the composed `app`, and its return value becomes the bundle's default export.
  - Without it, the default export is `{ fetch: app }`.
  - Platform handlers (`scheduled`, `queue`, `email`) are the app's code, typed by the app: `satisfies ExportedHandler<Env>`.
  - Dev never calls `build`, so there is no cron in dev, as today.
  - On the Node target, `host` fails the build. Node has no module host to hand an export to.
- **`index.ts`'s named exports** are still re-exported from the fetch bundle (Durable Object and Workflow classes). There is no `bindings` exception anymore.
- **`index.ts` is still optional.** Without it there are no settings, the app is `next`, and the export is `{ fetch: app }`.

### What `next()` resolves, in order

1. **Remote call** (`isCall`): dispatch to the sidecar. A missing call is a JSON 404, as today.
2. **Twin stream** (`GET /.expressive/stream`, Node and dev): the stream. The fetch target refuses seats and twins, so it has none.
3. **`/api/*`**: the matching `api/` route. An unmatched path is a JSON 404 and never the shell. An unhandled method is a 405 with `Allow`.
4. **Pages and static files.** The fallback below is Node's today (`200.html`, then `index.html`), now shared by every host:
   - **Node:** the file from `dist/client` (`/assets/` cached immutable), else `<path>/index.html`, else `200.html` or `index.html`, else 404.
   - **Dev:** a `public/` file, else the shell as Vite transforms it.
   - **Fetch target:** `assets.fetch(request)`. If that is a 404 on a GET or HEAD, `assets.fetch` gets `/200` and then `/`, keeping the method. This replaces the fallback each Workers app hand-writes today. Without `assets`, the answer is 404.

**Twin streams go through `serve`.** Today they skip `around`. Passing them through keeps "every request" literal, and it lets a gate refuse a stream (a banned or signed-out tab) before it opens. The cost is one middleware pass per stream (re)connect. Frames on an open stream come from calls, which each run their own `serve`.

**Seats are untouched.** A seat is built and used inside calls, so each method call runs inside `serve`. A seat outlives any one request's scope (`ttl`), so it must not hold a per-request session. That was already true under `around`.

**In dev, Vite's module requests skip `serve`.** These are `/@vite/*`, `/@id/*`, `/@fs/*`, `/node_modules/*`, `/.expressive/*` other than the stream, and paths naming a source file under the root outside `public/`. None of them exist in production. Today `fetch` and `around` see them, which the README warns about. Everything production would see goes through `serve`.

## `api/`: routes by location

A root `api/` folder sits beside `app/` and is served under a fixed `/api` prefix. It uses `app/`'s path syntax: `api/photo/[id].ts` serves `/api/photo/:id`, `api/auth/[...].ts` serves `/api/auth/*`, and `api/index.ts` serves `/api`.

**Location makes a route, never its exports.** Every module under `api/` is a route, except `*.test.*` and `*.spec.*`. Helpers live outside it, in `server/` for example. Exports only choose how a route dispatches:

```ts
// api/photo/[id].ts
export const GET = (request: Request, { id }: Params) => photo(id, request);

// api/auth/[...].ts - every method
export default (request: Request) => auth(env).handler(request);
```

```ts
export type Params = Record<string, string>;   // a [...] segment lands under "*", as the router's match names it
export type Route = (request: Request, params: Params) => Response | Promise<Response>;
// a module exports GET | POST | PUT | PATCH | DELETE | OPTIONS?: Route, and/or default?: Route
```

**Decision: both method exports and a default.**

- An exported method answers that method, and HEAD falls to GET.
- `default` answers any method not exported.
- With neither matching, the answer is 405 with `Allow` listing the exported methods. A module that exports no handler at all fails the build and the dev server; it is not skipped silently.

Why both:

- Method exports make the common case (a GET, a POST) self-describing and give 405 for free.
- A whole-surface handler (Better Auth, a webhook relay, a proxy) needs one function for every method, and listing six aliases to it is noise.
- Neither choice decides *whether* the file is a route.

**No `next` in a route.** The only meaningful fall-through for a matched `/api` path is 404, so returning one says it.

**Other rules:**

- Routes run inside `serve`'s `next()` and share its scope: `Current`, `Cookies`, `env`, and the cookie session the gates mint. Gates (`route(Session, …)`) belong to remote calls. A route that needs a grant checks it itself, or `serve` gates `/api/...` paths.
- Matching reuses the router's matcher (`url.ts`), so precedence is the same as pages: fixed, then `:param`, then `*`.
- `api/` is server-only. A client module importing from it fails the build, as it would for another folder's sidecar.
- `app/api/` is reserved and fails the dev server and the build, because `/api` belongs to the root folder. A remote call never targets `/api`.
- `api/` routes are not prerendered.

## Mechanics

### Registry

A module in dev, shared through one tsdown chunk by `dist/index.js`, `dist/server/*` and `dist/fetch.js`, holds `{ settings?, handler?, build?, sealed }`.

- **Once per evaluation.** `config`, `serve` and `host` each set their slot. A second call to the same one throws: "`serve()` is already set - call it once, at `index.ts`'s top level."
- **Old keys throw too.** `config` rejects unknown keys by name, the 0.5 ones included: "`fetch` and `around` moved to `serve()` …". This is the migration error.
- **Sealed when composed.** The generated entry composes the app from the registry and then seals it. A call after that throws: "`config()` ran after the app was composed - call it at `index.ts`'s top level, not after an await or in a callback". That covers `target` being set after dev read it.
- **Reset before each evaluation of `index.ts`.** That is before the build's settings read, before each dev reload, and before a test's import (below).
- **One instance.** In dev, `@expressive/dev` stays external to Vite's runner, so `index.ts` (through the runner) and the plugin (through Node) load the same chunk. The fetch build bundles both through the same file. No `globalThis` keys are needed.

### Settings at build

- The plugin's `config` hook still loads `index.ts` with `runnerImport` to read `target` and `remote`, now from the registry.
- `dev build` does that once for each of its two builds, and resets before each.
- For the server bundle, a transform on `index.ts` drops the `bindings` property from the `config({ … })` call. The function it referenced is then dead, and tree-shaking takes its dynamic imports (sqlite, local files) out of the Worker.
- This needs `config`'s argument to be an object literal at the call. Anything else fails the build with that reason. The literal also keeps the settings statically readable if we later stop executing `index.ts` at configure time.

### Generated entries

The plugin builds each entry from the registry rather than from a default export.

**Fetch:**

```ts
import { compose, exports } from "@expressive/dev/fetch";
import "../index.ts";                  // registers; static import evaluates first
import * as s0 from "../app/remote.ts";
import * as a0 from "../api/photo/[id].ts";
export { Room } from "../index.ts";   // index.ts's named exports, as today
export default exports(compose([s0], manifest, [a0], apiManifest));   // host's value, else { fetch: app }
```

**Node:** same imports. `listen({ client, sidecars, seats, api })` (today's `serve` in `/server`, renamed) composes and serves `app(request, { ctx, assets: dist/client })`, with the shell fallback above.

**Dev:** the plugin imports a virtual `/.expressive/server.ts`:

```ts
import { compose } from "@expressive/dev/server";
export default compose(() => import("../index.ts"));   // reset, evaluate, seal
```

- Its middleware calls `app(request, { env: await bindings(), ctx, assets: public/ + Vite's shell })`.
- An edit to `index.ts` or anything it imports invalidates the virtual entry through the module graph, so the next request re-evaluates both, resetting first.
- The first PR verifies that the runner propagates through the dynamic import. If it doesn't, a `hotUpdate` hook that sees `index.ts`'s graph invalidates the entry.
- Server patching in place (#745, #746) must treat `index.ts` as a re-evaluation boundary.

### Tests

`@expressive/dev/server` exports `app: App`, composed from whatever is registered:

```ts
import "../index.ts";
import { app } from "@expressive/dev/server";

const page = await app(new Request("http://x/invite/abc"), { env, assets: { fetch: async () => new Response(shell) } });
```

Outside a build, no remotes or api routes are registered, so this tests `serve`'s own logic (a sign-in link, a page rewrite) against a stubbed `assets`. Vitest's module isolation gives each test file a fresh registry.

### `env`

- Today, dev's root `env` re-exports `@expressive/env`: `.env` files over `process.env`.
- `/server` gains its own `env`. In a request it reads the request's bindings first (rpc's `Current.env`), then the same files.
- Outside a request (module scope, `scheduled`), `/server`'s `env` reads only the files. Handlers there get the platform's `env` argument, as today.
- Types: `Readonly<rpc.Env & envfile.Env>`.
- The root's `env` is unchanged: files only, shared with the client. rpc's AsyncLocalStorage never reaches a client bundle.

## Migration

**Recommendation: break outright in 0.6.0 (`minor`), with no deprecated path.**

- The old surface lived one release (0.4), extended in 0.5 with `next()`, and its only known consumer is on a pinned preview.
- A compatibility layer would keep the export-merging that this redesign exists to remove.
- The break is loud instead. An `index.ts` with a default export fails the dev server and the build: "`index.ts`'s default export is 0.5's config - call `config()`, `serve()` and `host()` instead", with a link to the README section. Old keys passed to `config()` name their new home.

| 0.5 | 0.6 |
| --- | --- |
| `export default config({ port, target, remote })` | `config({ port, target, remote })` |
| `export async function bindings()` | `config({ bindings })` |
| `around: (next, { env }) => db.session(next, …)` | `serve((request, next) => db.session(next, …))` |
| `fetch(request, env, ctx, next)` answering paths | an `api/` route, or `serve` around `next()` |
| `fetch` forwarding to `env.ASSETS` + shell fallback | `host(app => ({ fetch: (r, env, ctx) => app(r, { env, ctx, assets: env.ASSETS }) }))` |
| `scheduled` (and other members) | `host`'s return value |
| `Current.get().env` | unchanged, or `env` |

## Worked example

A Worker app: a database session per request on a D1 binding, an auth library, a dev-only sign-in link, a link-preview rewrite of one page, a file route and a cron. Under 0.5 it needed `around`, a path-matching `fetch`, its own `ASSETS`-plus-shell fallback, a `bindings` export and a pass-through `scheduled`.

```ts
// index.ts
import { config, env, host, serve } from "@expressive/dev/server";

import { db, d1 } from "./server/db";
import { signInAs } from "./server/dev";
import { preview } from "./server/preview";
import { sweep } from "./server/jobs";

config({
  target: "fetch",
  remote: { opaque: false },
  bindings: async () => (await import("./db/bindings.ts")).bindings(),
});

serve(async (request, next) => {
  const url = new URL(request.url);
  const dev = env.DEV_LOGIN === "1";

  if (!dev && url.pathname.startsWith("/api/dev/")) return new Response("Not found", { status: 404 });

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

host(app => ({
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app(request, { env, ctx, assets: env.ASSETS }),
  scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(db.session(() => sweep(new Date(event.scheduledTime)), d1(env.DB)));
  },
}) satisfies ExportedHandler<Env>);
```

```
api/auth/[...].ts     default: auth(env).handler(request) - the library's basePath becomes "/api/auth"
api/logout.ts         GET
api/photo/[id].ts     GET: the id from params, not parsed from the path
api/dev/mail.ts       GET: dev-only, gated by serve's prefix rule
```

What the port shows:

- **The shell fallback leaves the app.** `next()` runs it over `assets`.
- **The page rewrite runs in dev too**, because `next()` returns Vite's shell there. Under 0.5 it needed `ASSETS`, so it ran only in production.
- **Per-request module globals go.** An app that copied `env` into a module global per request (so deep code could read it) can read `env` instead. Concurrent requests in one isolate race on such a global.
- **One prefix rule gates dev-only routes** in `serve`, rather than a check in each route.
- **The cron opens its own session.** It runs outside `serve` because it is not a request.
- **Moving routes under `/api` is a URL change for the app.** Two things need care:
  - OAuth redirect URIs registered with a provider: add the new one before the deploy and remove the old one after.
  - Persisted URLs, such as a stored `/photo/<id>`, need a data rewrite. `serve` can keep a 308 from the old prefix for a release, for cached pages and installed PWAs.

## Open questions

Each has a recommendation; sign-off on these unblocks PR 1.

1. **Where the three functions export from.** The sketch imports them from `@expressive/dev`'s root. `FEATURE.md`'s agreed shape puts server-only API (`config`, `serve`, `Current`) in `@expressive/dev/server`, so a client import fails at build rather than at call.
   - Recommend keeping that rule: `config`, `serve`, `host`, `app` and the request-layered `env` all come from `/server`, so `index.ts` still has one import.
   - The root's `env` stays `@expressive/env`'s, the files-only reader that client and server share.
   - Today's `serve` in `/server` (the Node listener the generated entry calls) is renamed `listen`, which is a break inside 0.6.
   - If the root is preferred after all, the root's `env` becomes the layered one, with a `browser` condition keeping the client's.
2. **`assets` shape.** The sketch has `assets: () => env.ASSETS.fetch(request)`. Recommend `{ fetch(request) }`, so dev can also ask it for the shell (`/200`, `/`), which a zero-argument function can't. `env.ASSETS` then passes as is. That matters because the shell fallback is the part every Workers app gets wrong.
3. **`api/` dispatch.** Recommend method exports plus `default` for the remaining methods, as above. The alternative, `default (request, next)` only, gives up 405 and self-description and adds a `next` with nothing behind it.
4. **`ctx` in `serve`.** Recommend a third argument, `(request, next, ctx)`. That keeps `waitUntil` reachable without new `Current` surface. Routes and calls don't get it. Revisit if deeper code needs it, via rpc `bind(request, env, ctx)`.
5. **`env` layering.** Recommend bindings over files in a request, as above. This changes what dev's existing `env` export means on the server: it is still a superset, but now request-dependent.
6. **Migration.** Recommend a clean break with loud errors, as above, over a one-release deprecated path.
7. **`api/` beside rpc's `api/`.** `@expressive/rpc/vite`'s `rpc({ dir })` defaults to `api/` as a *call* folder: stubs on the client, no dynamic segments. dev's `api/` would be HTTP routes by URL.
   - Recommend keeping `api/` for dev, as chosen. The folder name matches its URL prefix, and a dev app reaches calls through sidecars, never `rpc()`.
   - Say so in both READMEs.
   - `FEATURE.md`'s deferred "rpc folder, beyond calls" (REST verbs on `Route`) is then largely answered by `api/` and can be trimmed to what is left (OpenAPI, the reply pipeline).
8. **Trunk.** Recommend landing PRs 1-4 on a `feat/dev-serve` trunk cut from this branch and releasing once. Publishing 0.6 with `serve` but without `api/` would make apps port twice.

## PR split

1. **Registry and composition** (updates `FEATURE.md`'s Config line).
   - `config`/`serve`/`host`, `App`, the registry with its once-per-evaluation, seal and reset rules, and `/server`'s `app` and `listen`.
   - Generated node, fetch and dev entries importing `index.ts`.
   - `next()` order for calls, streams and pages. `assets` with the shell fallback. Vite module requests bypassing `serve` in dev.
   - Migration errors. The README "Server" section and the skill rewritten. Changeset (`minor`).
2. **Build-only `bindings` and the layered `env`.** The transform dropping `bindings` from `config()`, the object-literal check, and `/server`'s layered `env`. A test proving the bundle carries no `bindings` import.
3. **`api/` routes.**
   - Scan and match (router's matcher), method/default/405 dispatch, the module-without-handler error, `app/api` reserved, and the client import guard.
   - Generated tables in the three entries, plus dev watch (add, unlink).
   - README and skill section, plus the example app.
4. **Verification.** `hot-probe.ts` cases for an `index.ts` edit (registry reset, no double-call throw) and an `api/` edit, plus a fetch-target build run through the example app.

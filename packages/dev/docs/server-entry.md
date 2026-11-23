# The server entry as calls

Design note for reshaping `@expressive/dev`'s server entry, for sign-off before any implementation. Once agreed, the root `FEATURE.md` takes its outcome (lines superseded: open question 7), and this file goes when the work lands.

## Why

0.5's `index.ts` default-exports `config({ port, target, remote, fetch, around, scheduled })`, and a named `bindings` export supplies dev's `env`. That shape has three problems:

- `fetch` reads as outbound. It is really a catch-all for requests that are not calls, so it overlaps `around`, which wraps the same requests.
- Unknown members (`scheduled`) pass through into the Worker's default export untyped. Any platform handler dev doesn't know about rides along by accident.
- Pages and static files are the app's job on the fetch target: an app carries its own `ASSETS`-plus-shell fallback, and a page rewrite built on it doesn't run in dev.

`fetch`, `around`, `target` and `bindings` shipped in 0.4.0 (#774, #777). `next()` followed in 0.5.0 (#794). Both releases are on npm. Neither has a known consumer outside a pinned preview build.

## Shape

`index.ts` calls three functions at its top level. It exports nothing for dev to read.

```ts
import { config, serve, host, env } from "@expressive/dev/server";   // see open question 1
import type { Env } from "@expressive/rpc";

config({ target: "fetch", remote: { opaque: false }, bindings: async () => (await import("./dev-env")).bindings() });

serve(async (request, next) => db.session(next, d1(env.DB)));

host(app => ({
  fetch: (request: Request, bound: Env, ctx: ExecutionContext) => app(request, { env: bound, ctx, assets: bound.ASSETS }),
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

/** What `next()` would answer: the call, the stream, the api route or the page. */
export type Next = () => Promise<Response>;

export type Handler = (request: Request, next: Next, ctx: Ctx) => Response | Promise<Response>;

export interface Ctx { waitUntil(promise: Promise<unknown>): void }

export interface AppOptions {
  /** This request's bindings: `env` and `Current.get().env`. Default `{}`. */
  env?: Partial<Env>;
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

/** In a request: its bindings, then `process.env`, then `.env` files. Outside one, bindings read `undefined`. */
export const env: Readonly<Env & FileEnv>;

/** Test seam: the app composed from what is registered. */
export const app: App;

/** api/ routes. */
export type Params = Record<string, string>;
export type ApiRoute = (request: Request, params: Params, ctx: Ctx) => Response | Promise<Response>;
```

New public surface, all on `/server`, for sign-off (AGENTS.md): `config`, `serve`, `host`, `env`, `app`, and the types `Settings`, `Handler`, `Next`, `Ctx`, `AppOptions`, `App`, `Params`, `ApiRoute`. Removed or renamed: `AppConfig` → `Settings`, `Scope` (gone), `serve` → `listen` (the Node listener the generated entry calls), `@expressive/dev/fetch`'s `fetchHandler` → the entry's composer, and the plugin API `Host.config()` returns `Settings`. Entry plumbing (`listen`, the composers) stays on `/server` and `/fetch` as today, documented as not app API.

**Typing hole:** `env.DB` typechecks outside a request and reads `undefined` there (module scope, `scheduled`). The examples name the platform's parameter `bound` so it never shadows `env`; the README states the rule.

`Env` is still augmented where `Current.get().env` reads it: `declare module "@expressive/rpc" { interface Env { … } }`.

### Semantics

- **`config`** holds build and run settings. Dev reads them while Vite configures. Only `bindings` leaves the bundle (below); Node's entry needs `port` at runtime.
- **`serve(handler)`** wraps every request the host forwards: remote calls, twin streams, `/api/*`, and pages and static files. A host that answers static files itself first (Workers assets without `run_worker_first`) never forwards those, so a gate in `serve` does not cover them. It replaces both `fetch` and `around`, and absorbs #794's `next()`.
  - Without `serve`, the app is `next`.
  - The handler runs in the request's scope, so `Current`, `Cookies` and `env` work. Headers and cookies it sets join the reply, including a call's reply and a call's error reply (`failure()` gains the outgoing headers). A 101 (WebSocket upgrade) passes through unjoined, since rebuilding it drops the socket.
  - The scope ends when the handler resolves. A streamed body and `waitUntil` work run after that, as with `around` today.
  - On a call request, a throw from the handler replies as a call's error would, so a gate can throw `Unauthorized` and keep its class. On any other request the throw reaches the host. On Node and in dev that is a logged 500 (today Node answers a bare 400).
  - A body read before `next()` is gone - read a `clone()`.
- **`host(build)`** is optional, and only for the fetch target. It gets the composed `app`, and its return value becomes the bundle's default export.
  - Without it, the default export is `{ fetch: (request, env, ctx) => app(request, { env, ctx }) }`. The host's bindings stay bound, as in 0.5.
  - Platform handlers (`scheduled`, `queue`, `email`) are the app's code, typed by the app: `satisfies ExportedHandler<Env>`.
  - Dev never calls `build`, so there is no cron in dev, as today.
  - On the Node target, `host` fails the build and the dev server. Node has no module host to hand an export to.
- **`index.ts`'s named exports** are still re-exported from the fetch bundle (Durable Object and Workflow classes). There is no `bindings` exception anymore.
- **`index.ts` is still optional.** Without it there are no settings, the app is `next`, and the export is the default above.

### What `next()` resolves, in order

1. **Remote call** (`isCall`, including `POST /.expressive/detached`): dispatch to the sidecar. A missing call is a JSON 404, as today.
2. **Twin stream** (`GET /.expressive/stream`, Node and dev): the stream. The fetch target refuses seats and twins, so it has none.
3. **`/api/*`**: the matching `api/` route. An unmatched path is a JSON 404 and never the shell. An unhandled method is a 405 with `Allow`.
4. **Pages and static files**: the file, else `<path>/index.html`, else the shell, else 404. One shell rule on every host: only for GET or HEAD, never under `/assets/` and never for a path with an extension, so a stale chunk stays a 404 instead of becoming HTML with the wrong MIME type. (Node today falls back for any method and path; this narrows it.)
   - **Node:** from `dist/client`, with `/assets/` cached immutable. The shell is `200.html`, else `index.html`.
   - **Dev:** a `public/` file, else the shell as Vite transforms it. Anything else falls through to Vite's middleware stack (below).
   - **Fetch target:** `assets.fetch(request)`; on a 404 that the shell rule covers, `assets.fetch` gets `/200.html` and then `/index.html`, keeping the method and following one same-origin redirect (an asset host that serves pretty URLs redirects these). This replaces the fallback each Workers app hand-writes today. Without `assets`, the answer is 404.

**Twin streams go through `serve`.** Today they skip `around`. Passing them through keeps "every request" literal, and it lets a gate refuse a stream (a banned or signed-out tab) before it opens. The cost is one middleware pass per stream (re)connect. Frames on an open stream come from calls, which each run their own `serve`.

**Seats are untouched.** A seat is built and used inside calls, so each method call runs inside `serve`. A seat outlives any one request's scope (`ttl`), so it must not hold a per-request session. That was already true under `around`.

**In dev, `serve` sees what production would, and Vite keeps the rest.**
- Calls are checked first, so `/.expressive/detached` and every other call go through `serve`.
- Vite's own URLs skip `serve`: under `base`, `/@vite/*`, `/@id/*`, `/@fs/*`, `/node_modules/*`, `/.expressive/*` other than calls and the stream, `?import`/`?url`/`?raw`, and paths naming a source file under the root outside `public/`. Today `fetch` and `around` see them, which the README warns about.
- The page step must not starve later middlewares: inspect's `/__inspect` relay, other plugins' middlewares, `server.proxy`, `/__open-in-editor`. When `next()` found no `public/` file and the request is not a navigation, it resolves a marked 404. If the handler returns that response untouched, the middleware hands the request to Vite's stack instead. The mark survives header joining.

## `api/`: routes by location

A root `api/` folder sits beside `app/` and is served under a fixed `/api` prefix. It uses `app/`'s path syntax: `api/photo/[id].ts` serves `/api/photo/:id`, `api/auth/[...].ts` serves `/api/auth/*`, and `api/index.ts` serves `/api`.

**Location makes a route, never its exports.** Every `.ts`, `.tsx`, `.js` or `.jsx` module under `api/` is a route, except `*.test.*`, `*.spec.*` and `.d.ts`. Helpers live outside it, in `server/` for example. Exports only choose how a route dispatches:

```ts
// api/photo/[id].ts
export const GET: ApiRoute = (request, { id }) => photo(id, request);

// api/auth/[...].ts - every method
export default (request: Request) => auth(env).handler(request);
```

A module exports `GET`, `POST`, `PUT`, `PATCH`, `DELETE` or `OPTIONS` as an `ApiRoute`, and/or a `default`. Params are decoded; a `[...]` segment lands under `"*"`, as the router names it.

**Decision: both method exports and a default.**

- An exported method answers that method. HEAD falls to GET, the host drops the body, and `Allow` lists HEAD wherever GET is exported.
- `default` answers any method not exported.
- With neither matching, the answer is 405 with `Allow` listing the exported methods. A module that exports no handler at all fails the build and the dev server; it is not skipped silently.

Why both:

- Method exports make the common case (a GET, a POST) self-describing and give 405 for free.
- A whole-surface handler (Better Auth, a webhook relay, a proxy) needs one function for every method, and listing six aliases to it is noise.
- Neither choice decides *whether* the file is a route.

**No `next` in a route.** The only meaningful fall-through for a matched `/api` path is 404, so returning one says it.

**Other rules:**

- Routes run inside `serve`'s `next()` and share its scope: `Current`, `Cookies`, `env`, and the cookie session the gates mint. Gates (`route(Session, …)`) belong to remote calls. A route that needs a grant checks it itself, or `serve` gates `/api/...` paths.
- Matching is exact and case-sensitive, on the path `serve` sees, so a gate in `serve` sees the path that will match. That rules out the router's client matcher (`url.ts` lowercases literals and trims slashes); the api table gets a strict one. Precedence follows the page tree's sort (`routes.ts`): fixed, then `:param`, then `*`.
- `api/` is server-only. A client module importing from it fails the build, as it would for another folder's sidecar.
- When a root `api/` exists, `app/api/`, `app/api.tsx`, `app/(api).tsx` and `public/api/` fail the dev server and the build, because `/api` belongs to the folder. A root `[slug]` page can't be reached at `/api` either, and the 404 there says so. Without `api/`, an app may still own `/api` itself.
- `api/` routes are not prerendered.
- On Node and in dev, `send` buffers any `application/json` body. A streamed route uses another type, such as `application/x-ndjson`.

## Mechanics

### Registry

A module in dev, shared through one tsdown chunk by `dist/server/*` and `dist/fetch.js`, holds `{ settings?, handler?, build?, sealed }`.

- **Once per evaluation.** `config`, `serve` and `host` each set their slot. A second call to the same one throws: "`serve()` is already set - call it once, at `index.ts`'s top level."
- **Old keys throw too.** `config` rejects unknown keys by name, the 0.5 ones included: "`fetch` and `around` moved to `serve()` …". This is the migration error.
- **Sealed when composed.** The generated entry composes the app from the registry and then seals it. A call after that throws: "`config()` ran after the app was composed - call it at `index.ts`'s top level, not after an await or in a callback". That covers `target` being set after dev read it.
- **Reset when `index.ts` evaluates, and only then.** The plugin's transform prepends the reset to `index.ts` itself. Tying it to the entry would fail two ways. An entry re-run with `index.ts` cached (an `api/` file added regenerates the table) would reset and re-register nothing, silently dropping the gate. An `index.ts` patched in place would throw "after composed".
- **The plugin never imports the registry.** It reads settings through a module evaluated on the same runner as `index.ts`: the virtual entry in dev, and at build an inline-plugin virtual module passed to `runnerImport`. One instance then holds whatever resolves `@expressive/dev`: an installed package, the suite's `src` aliases (`plugin.test.ts`), or two copies (a global bin beside a local install). No `globalThis` keys.

### Settings at build

- The plugin's `config` hook still loads `index.ts` with `runnerImport` to read `target` and `remote`, now from the registry.
- `dev build` does that for each of its builds (client, server, and prerender when on), and each evaluation resets itself.
- For the server bundle, a transform on `index.ts` drops the `bindings` property from the `config({ … })` call, and tree-shaking takes the function's dynamic imports (sqlite, local files) out of the Worker.
- Rule: import inside the function. App modules are not `sideEffects: false`, so a static import the stripped value used would stay. The build fails when it does, when `config`'s argument is not an object literal, and on an aliased, namespace or spread `config` it can't read. Alternative in open question 9.

### Generated entries

The plugin builds each entry from the registry rather than from a default export. `/.expressive/server.ts` stays the one id; its load branches on dev or build, as it already branches on target.

**Fetch:**

```ts
import { compose, exports } from "@expressive/dev/fetch";
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

Outside a build, no remotes or api routes are registered, so this tests `serve`'s own logic (a sign-in link, a page rewrite) against a stubbed `assets`. Vitest's default per-file isolation gives each test file one evaluation of `index.ts`. `vi.resetModules()` does not reset an externalised `/server`, so a second import in the same file throws "already set". Open question 10.

### `env`

- Today, dev's root `env` re-exports `@expressive/env`: `process.env` over `.env` files.
- `/server` gains its own `env`. In a request it reads the request's bindings first (rpc's `Current.env`), then `process.env`, then the files.
- Outside a request (module scope, `scheduled`), it reads `process.env` and the files. Handlers there get the platform's `env` argument, as today.
- On the fetch target there is no file layer: bindings, then `process.env` if defined. The fetch build aliases the file reader to a `process.env`-only one, so `node:fs`, `node:path` and `node:util` stay out of the bundle. The README's claim that it imports only `node:async_hooks` and `node:crypto` holds.
- Types: `Readonly<rpc.Env & envfile.Env>`.
- The root's `env` is unchanged: files only, shared with the client. rpc's AsyncLocalStorage never reaches a client bundle.

## Migration

**Recommendation: break outright in 0.6.0 (`minor`), with no deprecated path.**

- `export default config({ port, remote })` dates to 0.1. `fetch`, `around`, `target` and `bindings` are in two published releases (0.4, 0.5). The only known consumer of the latter is on a pinned preview.
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
| `AppConfig`, `Scope` | `Settings`; `Scope` gone |
| `serve` from `/server` (generated entries only) | `listen` |
| `fetchHandler` from `/fetch` (generated entries only) | the entry's composer |

## Worked example

A Worker app: a database session per request on a D1 binding, an auth library, a dev-only sign-in link, a link-preview rewrite of one page, a file route and a cron. Under 0.5 it needed `around`, a path-matching `fetch`, its own `ASSETS`-plus-shell fallback, a `bindings` export and a pass-through `scheduled`.

```ts
// index.ts
import { config, env, host, serve } from "@expressive/dev/server";
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

serve(async (request, next) => {
  const url = new URL(request.url);
  const dev = env.DEV_LOGIN === "1";

  const [, root, area] = url.pathname.split("/");

  if (!dev && root === "api" && area === "dev") return new Response("Not found", { status: 404 });

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
  fetch: (request: Request, bound: Env, ctx: ExecutionContext) => app(request, { env: bound, ctx, assets: bound.ASSETS }),
  scheduled(event: ScheduledController, bound: Env, ctx: ExecutionContext) {
    ctx.waitUntil(db.session(() => sweep(new Date(event.scheduledTime)), d1(bound.DB)));
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
- **One rule gates dev-only routes** in `serve`, rather than a check in each route. It compares segments exactly, as the strict api matcher does, so `/api/DEV/mail` and `/api/dev` can't slip past.
- **The cron opens its own session.** It runs outside `serve` because it is not a request.
- **Moving routes under `/api` is a URL change for the app.** Two things need care:
  - OAuth redirect URIs registered with a provider: add the new one before the deploy and remove the old one after.
  - Persisted URLs, such as a stored `/photo/<id>`, need a data rewrite. `serve` can keep a 308 from the old prefix for a release, for cached pages and installed PWAs.

## Open questions

Each has a recommendation; sign-off on these unblocks PR 1.

1. **Where the three functions export from.** The original sketch imported them from `@expressive/dev`'s root. `FEATURE.md`'s agreed shape puts server-only API (`config`, `serve`, `Current`) in `@expressive/dev/server`, so a client import fails at build rather than at call.
   - Recommend keeping that rule: `config`, `serve`, `host`, `app` and the request-layered `env` all come from `/server`, so `index.ts` still has one import.
   - The root's `env` stays `@expressive/env`'s, the files-only reader that client and server share.
   - If the root is preferred after all, the root's `env` becomes the layered one, with a `browser` condition keeping the client's.
2. **`assets` shape.** The original sketch had `assets: () => env.ASSETS.fetch(request)`. Recommend `{ fetch(request) }`, so dev can also ask it for the shell, which a zero-argument function can't. `env.ASSETS` then passes as is. That matters because the shell fallback is the part every Workers app gets wrong.
3. **`api/` dispatch.** Recommend method exports plus `default`. `default (request, next)` alone loses 405 and adds a `next` with nothing behind it.
4. **`ctx`.** Recommend a third argument to `serve`'s handler and to api routes, for a webhook's `waitUntil`. Calls don't get it; revisit via rpc `bind(request, env, ctx)` if deeper code needs it.
5. **`env` layering.** Recommend bindings, then `process.env`, then files, on `/server` only.
6. **Migration.** Recommend the clean break.
7. **`api/` was already assigned.** `FEATURE.md`'s agreed shape has dev hosting rpc's call folder, `api/` by default: stubs on the client, no dynamic segments, one invocation path with sidecars (lines 22, 83, 185, and 302's "dev does not host an rpc `api/` folder yet"). HTTP routes at `api/` reverse that.
   - Recommend taking `api/` for HTTP routes, as chosen. If dev ever hosts an rpc call folder, it takes another name (for example `rpc/`).
   - The cost: a client import fails from dev's `api/` but is a stub from rpc's `api/`. Both READMEs say which is which.
   - `FEATURE.md` lines 22, 83, 185 and 302 get updated. Line 233's "rpc folder, beyond calls" (REST verbs, the reply pipeline, OpenAPI) concerns rpc's external-client lane and stays.
8. **Trunk.** Recommend landing PRs 1-4 on a `feat/dev-serve` trunk cut from this branch and releasing once. Publishing 0.6 with `serve` but without `api/` would make apps port twice.
9. **`bindings` as a path.** `bindings: "./db/bindings.ts"`, a module only dev imports, needs no AST strip, no literal rule and no tree-shaking, at the cost of checking the module's default export only by its own `satisfies`. Recommend keeping the function (typed at the call) with the strict build rule; the path is the fallback if the transform turns out brittle.
10. **A test reset.** Recommend none for now: one `index.ts` evaluation per test file. Per-test resets would need an exported `reset()`, which is new surface.

## PR split

1. **Registry and composition** (updates `FEATURE.md`'s Config line, plus the lines in open question 7).
   - `config`/`serve`/`host`, `App`, the registry with its once-per-evaluation, seal and reset rules, and `/server`'s `app` and `listen`.
   - Generated node, fetch and dev entries importing `index.ts`.
   - `next()` order for calls, streams and pages. `assets` with the one shell rule. In dev, Vite's URLs bypass `serve`, with fall-through to Vite's stack. Headers join error replies, 101 passes through, and Node answers a throw with a logged 500.
   - Migration errors. The README "Server" section and the skill rewritten. Changeset (`minor`).
2. **Build-only `bindings` and the layered `env`.** The transform dropping `bindings` and its build errors, `/server`'s layered `env`, and the fetch build's file-free reader. Tests prove the bundle carries neither the `bindings` imports nor `node:fs`.
3. **`api/` routes.**
   - Scan and a strict matcher, method/default/405 dispatch, the module-without-handler error, the `/api` reservations, and the client import guard.
   - Generated tables in the three entries, plus dev watch (add, unlink).
   - README and skill section, plus the example app.
4. **Verification.** `hot-probe.ts` cases for an `index.ts` edit (registry reset, no double-call throw) and an `api/` edit, plus a fetch-target build run through the example app.

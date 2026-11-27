---
name: expressive-dev
description: Expressive app host (@expressive/dev) - expressive dev and dev build over Vite with @expressive/dom, a generated route tree, inspect and rpc. Use when working in an @expressive/dev app - layout, route modules, api/ routes, calls and gates, commands.
---

# @expressive/dev

App host: `expressive dev` and `expressive dev build` over Vite, rendering with `@expressive/dom`, routing with `@expressive/router` from a generated tree, `@expressive/inspect` on the dev server, server calls through `@expressive/rpc`.

```bash
npm install @expressive/dev @expressive/mvc
```

tsconfig: `"jsxImportSource": "@expressive/dev"` - dom's runtime and its `Model` augmentation. `include` must list `api`, `index.ts`, `index.dev.ts` beside `app` - nothing imports them: `["app", "api", "index.ts", "index.dev.ts", "env.d.ts"]`.

`@expressive/dev` exports `Route`, `Router`, `Redirect`, `NotFound` and rpc's `HttpError` family, plus `Link` and `NavLinks` and `render`, `style`, `Css`, `Style`, `Portal`, `Fragment`, `createElement` and `JSX` from `expressive-dom`. `Model`, `Component` and instructions come from `@expressive/mvc`. The dev server's inspector is `expressive-inspect`. Per-symbol contracts are JSDoc on hover.

## Layout

```
app/                  file-based routes - frontend only; a remote.ts or remote/ here fails generation
  index.tsx           /            exports: Page, Layout, Loading, Catch, label, Router, default
  (about).tsx         /about       static leaf
  blog/index.tsx      /blog        folder = scope; its index is the page
  blog/[slug].tsx     /blog/:slug  param leaf
  docs/[...].tsx      /docs/*      catch-all - zero segments or more; docs/index.tsx wins /docs
app.tsx | src/app.tsx single root component instead of app/ (default export)
api/                  optional server code under /api: HTTP routes, calls, folder gates - see api/ routes
index.ts              optional server entry: export default config({ port, handle, target, host })
index.dev.ts          optional, dev only: index.ts's settings plus env() - see env and index.dev.ts
index.html            optional shell (#root and the entry script injected if missing)
vite.config.ts        optional, merged under the host's
.env, .env.*          optional - see Environment
```

Bare-named files under `app/` and `api/` are support modules. Siblings match static before `:param` before `*`.

## Route modules

- `Page` - a function (params via `Route.get().match`) or `class Page extends Route` (from `@expressive/dev`) with `this.match`, fields and `render()`.
- `Layout` - wraps the folder's pages; `children` is the content slot.
- `Loading` - placeholder for the slot of the `Layout` beside it, for any page below still loading code, a default guard or data, until a nested `Layout`. A page's own `Loading` covers it first. Shown on cold arrival only - in-app navigation holds the current page (`Router.get().navigating`).
- `Catch` - error boundary for the folder, given `{ error, retry }`. Handle `error instanceof NotFound` here. An unmatched path below the folder also throws `NotFound`; without `Catch`, the root shows a plain 404 or generic error.

```tsx
import { NotFound, Redirect } from "@expressive/dev";
export function Page() {
  if (!record) throw new NotFound();
  if (!session) throw new Redirect("/login");
  return <article>{record.title}</article>;
}
export const Catch = ({ error, retry }) => error instanceof NotFound
  ? <p>Not found</p> : <button onClick={retry}>Try again</button>;
```

`Catch` replaces its folder's `Layout`. A folder `Catch` claims unmatched paths below it ahead of a root `[...]` page. A redirect immediately followed by another shows `Catch`; `a → b → c` stops at `b`.
- `label` - names the route for breadcrumbs (`Route.get().parent.label`). `const` string literal only - inlined into the tree; anything else fails generation. A folder's `index.tsx` labels the folder - or, with no other routes inside, the one route it collapses to (`Route.get().label`). In dev, an edit shows after a restart.
- `Router` - root `index.tsx` only: a subclass of `Router` from `@expressive/dev` (not router's `BrowserRouter`), mounted in its place - override `navigate()`, add methods. `Router.get()` and the subclass's `get()` both find it. Prerendering constructs it and runs `new()` without `window` - guard what touches it there.
- `default` → `Layout` → `Page` is the content order; each is optional. A missing export passes content through. In a leaf, `default` is the page; `Page` still works.
- A class `default` is built before render, during the navigation hold. It is destroyed after navigation settles away, rebuilt on re-entry or a param change. Guard in `new()`; it may await and throw `Redirect` or `NotFound`. `new()` runs once per instance, so a sign-out guard there does not re-run - read the session in `render()` when the page must react. A Model is provided below; a Component also renders around `Layout` and `Page` through `props.children`. `X.get()` finds it below. A leaf Model without `Page` renders nothing and warns. An index default that never reads `children` warns when the module has `Page` or `Layout` or the folder has routes below.
- A function `default` renders as a wrapper, or as a leaf page. Text-only pages need a fragment; returning a string fails with the module name.
- `paths` - below a `[param]` or `[...]`, the absolute paths a prerendering build renders; may be async. Bundled with the client - no Node APIs; use static imports, `import.meta.glob` or an absolute-URL `fetch`.

Each module is its own chunk, loaded on first entry, unless it is the root or exports `Loading` or `Catch`.

```tsx
// app/me/index.tsx
import { Redirect } from "@expressive/dev";
import { Component, get, set } from "@expressive/mvc";
import { Session } from "../session";
import * as account from "../../api/(account)";

export default class Me extends Component {
  session = get(Session);
  profile = set(() => account.profile());

  protected new() {
    if (!this.session.me) throw new Redirect("/signin");
  }
}

export function Page() {
  const { profile } = Me.get();
  return <h1>Hi, {profile.name}</h1>;
}
```

## Commands

```
expressive dev                  Vite dev server with HMR and inspect's /__inspect relay
expressive dev --no-inspect     without the relay
expressive dev --port <n>       listen on <n> - over index.ts's port and Vite's
expressive dev --no-env         without copying .env into process.env
expressive dev build            dist/client and dist/server/index.js
expressive dev build --pretty   unminified client, stable filenames
expressive dev build --no-html  without prerendered pages
expressive dev build --no-env   same, for the build and the built server
expressive env                  write env.d.ts, warn of unset keys - expressive-env
expressive help [command]       commands, or one command's inputs
node dist/server/index.js       run the built service (port from index.ts, default 3000)
```

Nothing is written into the project - the shell, entry and route tree are virtual under `/.expressive/`. `@expressive/dev/vite` exports `expressive()` for a hand-written Vite config - add `@expressive/dom/vite` for hot reload and `inspect()` from `@expressive/inspect/vite` for the relay. Server code runs on Vite's module runner in dev, with Node's `import.meta`.

## Server entry

`index.ts` default-exports `config({ ... })` from `@expressive/dev` - identity, types the settings: `target`, `port`, `remote`, `handle`, `host`. Any other key fails dev and the build by name.

`handle({ request, env, ctx, next })` is fetch middleware around every request the host forwards - `api/` calls and routes, pages, static files. Return a `Response` to answer, nothing to pass.

```ts
// index.ts - db is SQLiteConnection.new(types, "app.db"), skill expressive-sql
export default config({
  handle: ({ next }) => db.session(() => next()),
});
```

- Nothing returned: `next()`'s reply if called, else `next()` is called - after `handle` returned, outside anything it wrapped. Other return values throw. `next()` once, and only until `handle` returns.
- Returning nothing is for a `handle` that doesn't wrap the app (a check, a log). A wrapping `handle` returns the wrapper with `return next()` inside: `({ next }) => db.session(() => next())`. Never `async ({ next }) => { await db.session(...); }` - `next()` is never called inside the session, so the app runs after it closed and fails with its error; dev warns once on a 5xx after a `handle` that returned nothing.
- `next(request)` forwards a rewrite; a non-`Request` argument throws - wrap callbacks: `db.transaction(() => next())`. Read the body through `request.clone()` to still pass it on.
- `next()` resolves a `Response` with mutable headers (101 as is); a throw below resolves its error reply. A discarded reply's body is cancelled.
- Outside the request's scope: `Current`, `Cookies`, `get(Model)` throw in `handle`, work inside `next()`. Cookies go on the returned `Response`; after-work through `ctx.waitUntil`.
- A thrown `HttpError` answers its status - a call's error on a call, else JSON `{ message }` (`Redirect` sets `Location`). Else a logged 500, message in dev only.
- Below it: an `api/` call or route under `/api`, else the file or `<path>/index.html` - Node: from `dist/client`; `fetch` target: from `assets`, default `env.ASSETS`; dev: from `public/`. Else the shell (`200.html`, else `index.html`) for GET or HEAD outside `build.assetsDir` - 200 where a page route matches, 404 for an unmatched navigation (`accept` has `text/html`), so `Catch` handles `NotFound`. Else a bare 404 - a stale chunk never gets HTML. Built, other methods get 404. Single-file (`app.tsx`): every navigation gets the shell with 200.
- Page routes are `app/` files exporting `Page` or a leaf `default`. A route the scan can't see (custom root `Router`, `<Route>` in a `Layout`) gets the shell with 404 on a deep link - add a `[...]` page to claim its paths.
- Dev skips it for Vite's requests: outside `base`, `/@vite/*`, `/@id/*`, `/@fs/*`, `/node_modules/*`, `/.expressive/*` but calls, `/__inspect`, `/__open-in-editor`, `server.proxy` prefixes, bare `?import`/`?url`/`?raw`, source files outside `public/`. Calls and `/api` paths never skip. A passed request that is neither file nor navigation continues to Vite's middlewares with `handle`'s headers and forwarded request. Navigations get the shell first - a `vite.config.ts` plugin serving pages from its `configureServer` middleware needs `enforce: "pre"`.

`env` - the request's bindings, below.

Tests: `compose(settings)` from `@expressive/dev/server` - `handle` over a stubbed `assets`, no `api/` routes: `await compose(settings)(new Request("http://x/a"), { assets: { fetch: async () => new Response(shell) } })`. Test a route's logic as a plain function in a helper beside it that the route calls with what it reads from `Current`: `export const GET = () => photo(Current.get().params.id)`, then test `photo("7")`.

## api/ routes

A root `api/` folder beside `app/` is HTTP routes under `/api`, named as in `app/`: `api/(logout).ts` → `/api/logout`, `api/photo/[id].ts` → `/api/photo/:id`, `api/auth/[...].ts` → `/api/auth/*` (one segment or more), `api/index.ts` → `/api`. A bare name (`api/photo/store.ts`) is a helper - not a route, exports anything. `*.test.*`, `*.spec.*`, `.d.ts` are skipped. Routes take no parameters; read the request from `Current`.

```ts
// api/photo/store.ts - a helper
export const photo = (id: string) => db.photos.find(id);

// api/photo/[id].ts
import { Current } from "@expressive/dev/server";
import { photo } from "./store";

export const GET = () => photo(Current.get().params.id);

// api/account/index.ts - the folder's gate
export default () => {
  Session.new(); // async new() throws Unauthorized to refuse
};

// api/account/(me).ts
export const GET = () => Session.get().user;

// api/legacy/[...].ts - mount a fetch handler (Hono, an auth library) on /api/legacy/*
export default () => legacy.fetch;

// api/legacy/index.ts - /api/legacy itself
export const GET = () => legacy.fetch;
```

- `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS` answer that method on the module's path. Returned value: `Response` as is, object/array as JSON, string as text, nothing 204. HEAD runs `GET` without the body. Other methods: 405 with `Allow`. OPTIONS is never synthesised - CORS and preflight go in `handle` or a folder gate.
- HEAD runs `GET`'s side effects, and GETs get prefetched - nothing that changes state on `GET`. Logout is `POST`.
- A throw other than `HttpError` in a route or gate: logged 500, message in dev only.
- `default` outside a folder `index.ts`: catch-all for every method on its path. Routes take no arguments, so return the handler - a returned function (from a verb too) is called with `(request, env, ctx)`. The path is not rewritten - give the mounted app its base path (`basePath("/api/legacy")`). Bind a `fetch` that needs `this`.
- `default` in a folder `index.ts`: the folder's gate, before every route below, outermost first, on unmatched paths too. Finish to pass, throw to refuse (`HttpError` → its status as JSON `{ message }`, else logged 500), return a `Response` or fetch handler to answer, `Current.get().next()` to wrap. Its Models are `X.get()`-able below until the request ends. Sees its own folder's params; routes see the full match's.
- No route for the path, or an `index.ts` with only a gate: JSON 404, never the shell. In dev, a helper where the path would be (`api/webhook.ts` for `/api/webhook`) is named in the 404, with its `(name).ts` rename.
- Exact, case-sensitive, on decoded segments (`/api/caf%C3%A9` → `api/(café).ts`); fixed beats `[param]` beats `[...]`, no backtracking - `/api/admin/users` 404s under `api/admin/` without `users`, even beside `api/[org]/(users).ts`. A bad `%` escape is 400; an empty segment never matches, except inside `[...]`'s rest after its first.
- Params arrive decoded, slashes included - never join one onto a file path.
- Calls: any other exported async function in a route. The app imports it and gets a typed stub; it runs on the server. A call is a `POST` to the module's path with `x-expressive-call` naming it and a JSON array of arguments, answered `{ value }`; a `POST` without the header goes to the verbs. Always `POST` - export `GET` to serve a GET.

  ```ts
  // api/(account).ts
  export const GET = () => Session.get().user;
  export class Taken extends Error { status = 409; }
  export async function rename(name: string) { /* throw new Taken(...) to refuse */ }

  // app/me/index.tsx
  import { rename, Taken } from "../../api/(account)";
  ```

  - Folder gates run before a call as before a verb - a refusal rejects it with the gate's error, gate Models are `X.get()`-able in it, `next` wraps it.
  - An `Error` subclass any route exports - a gate's too - rejects on the client as the same class, fields kept.
  - Only calls the client build imports are callable, under per-build hashed ids unless `remote: { opaque: false }`. Dev: every call of a route the browser loaded.
  - Static paths only: a call under `[param]` or `[...]` fails the build - take the id as an argument. `api/index.ts`'s calls are reserved.
  - The client may import a route's calls, `Error` subclasses and types - not its verbs or `default`, nothing from a helper.
  - Guarding a page: its route `default`'s `new()` awaits a call, so the folder gates run before anything renders. A `Redirect` (or any error with a 3xx `status` and `location`) navigates; another refusal reaches `Catch`, whose `retry` builds the default again. A param page passes the id as an argument: `await members(this.route.match!.id)` with `route = get(Route)` in a leaf; a folder `default`'s `match` is its own path's, so below it read `route.router.match(route.path, "*")!.params`. Every call still runs its gates.
- `Cookies` (from `@expressive/dev/server`): a subclass declares cookies as fields; `AppCookies.get()` reads this request's and `AppCookies.set({ ... })` sends `Set-Cookie` with the reply. `Current` is the lower level: `.request`, `.url`, `.cookies`, read-only, and `setHeader(name, value)`.
- Process-wide state: a module-level `X.new(Context.root)`, found by `get()` from any call.
- Fail dev and the build: a route with no verbs, no `default` and no calls (a gate-only `index.ts` is fine); `default` beside verbs outside `index.ts`; a class gate; other runtime exports from a route - a sync function, a non-`Error` class, a value, a re-export (types fine; `api/index.ts`'s reserved); a call under a param; `export *` in a route (build only - list verbs by name); a helper exporting a verb-named function (build; dev logs on save) - helpers shouldn't export verb-named handlers, name the file `(name).ts` (values and re-exports not flagged); a nameless `().ts`, `(name)` folders, a `[...]` folder, `[...name]` (use `[...]` or `[name]`), a name starting with `:` or `*`, two `[param]`s in a folder, two modules on one path (`api/(dev).ts` + `api/dev/index.ts`); `app/api/`, `app/(api)/`, `app/(api).tsx`, `public/api/` beside `api/`, any case; a client import of a route's verb or `default`, or of a helper, through aliases too.
- Dev loads routes per request on the module runner - edits to routes and their helpers, and added, removed or renamed files, land on the next one. A save logs these errors; a broken route's requests answer a 500 naming it; a helper that doesn't parse fails only the routes importing it. Never prerendered.

## env and index.dev.ts

`handle`'s `env` and `Current.get().env`:
- `fetch` target: the host's `env` object as is.
- Node and dev: read-only over `process.env`, `.env` files and `index.dev.ts`'s `env()` (dev). Live objects from `env()` (`DB`) always come through; strings from the shell or `.env` override `env()`'s strings (wrangler's production `vars`); `process.env` beats `.env`.

`expressive dev` reads `index.dev.ts` in place of `index.ts` when it exists; the build never does, so its imports reach no bundle. It imports `./index` (no extension - no tsconfig flag), sets `settings.env`, default-exports the settings. `env` set in `index.ts`, a `bindings` export, or no default export in `index.dev.ts` fails dev and the build.

- `env()` runs once per dev server, again only after a throw - changing it needs a restart. `null`/`undefined` binds nothing.
- `{ ...env }` and `Object.keys(env)` see only `env()`'s keys on Node and in dev - read keys by name.
- On Node, open an app-owned database in a module instead. Workers bindings: Fetch target.

## Fetch target

`config({ target: "fetch" })` builds `dist/server/index.js` as a module, every dependency bundled, for a host that calls its default export's `fetch(request, env, ctx)`.

- `host(app)` returns the default export - platform handlers (`scheduled`) go there; without `fetch` it gets `{ fetch: (request, env, ctx) => app(request, { env, ctx }) }`. Dev never calls it; on Node it fails the build.
- `env` is the host's second `fetch` argument - in `handle` and `Current.get().env` - with no `process.env` or `.env` layer.
- Named exports of `index.ts` are re-exported - listed ones, not `export *`; types need `export type`.
- `index.ts` also loads in Node (build, dev) - import host-only modules lazily, list them in `vite.config.ts`'s `build.rollupOptions.external`; resolve conditions go there too.
- The bundle imports `node:async_hooks` and `node:crypto`.
- No boot file - `.env` does not fill `process.env`; the host's bindings are the environment.

Cloudflare Workers with static assets - a D1 session per request, a cron; pages and the shell come from `ASSETS`:

```ts
// index.ts - d1 is app code wrapping a D1 binding in sql's Engine
import { config, type Env } from "@expressive/dev";

declare module "@expressive/dev" { interface Env { DB: D1Database } }

export default config({
  target: "fetch",
  handle: ({ env, next }) => db.session(() => next(), d1(env.DB)),
  host: () => ({
    scheduled: (event: ScheduledController, bound: Env) => db.session(() => sweep(), d1(bound.DB)),
  }),
});
```

The binding must be named `ASSETS`; under another name, pass it: `host: app => ({ fetch: (r, env, ctx) => app(r, { env, ctx, assets: env.STATIC }) })`.

Dev gets the same bindings from wrangler's local platform:

```ts
// index.dev.ts
import type { Env } from "@expressive/dev";
import { getPlatformProxy } from "wrangler";
import settings from "./index";

settings.env = async () => (await getPlatformProxy<Env>()).env;

export default settings;
```

Local tables: `wrangler d1 migrations apply DB --local` - dev runs no migrations.

`wrangler.jsonc`: `"main": "dist/server/index.js"`, `"compatibility_flags": ["nodejs_compat"]`, `"assets": { "directory": "dist/client", "binding": "ASSETS", "run_worker_first": ["/*", "!/assets/*"] }`. Without `run_worker_first` a request for a path with a file skips the Worker, `handle` included. Leave `not_found_handling` unset - single-page mode serves the prerendered home page for client routes.

## Environment

`.env` files are built in - `expressive-env/SKILL.md` covers files, modes, types and editing.

```ts
import { env } from "@expressive/dev";

const db = connect(env.DATABASE_URL);
```

- `env` reads keys on the server; in the browser only `PUBLIC_` keys, read at build - any other throws. A custom prefix: `env({ prefix: "CLIENT" })` from `@expressive/env/vite` in `vite.config.ts`, which replaces the host's.
- The same files fill `process.env` in dev, during `dev build` and at the built server's boot, for dependencies that read it - keys already set and `NODE_ENV` are left alone. `--no-env` skips this; `env` reads the files either way. Elsewhere - a script, a tool, a `--no-env` app opting back in - call `registerEnv()` from `@expressive/dev/server` first.
- Mode is `NODE_ENV`, for client and server alike - `development` in dev, `production` for a build and a built server it is unset for. Files load from the working directory; a `vite.config.ts` `root` elsewhere splits the two sides.
- Types: run `expressive env` (a `prepare` script fits) - dev does not create `env.d.ts`, only refreshes it on `.env` changes.

## Prerendering

`expressive dev build` (and `runBuild` from `@expressive/dev/vite`) builds, then renders each page with `renderToString` (`expressive-dom/SKILL.md#server-rendering`) to `dist/client/<path>/index.html` - markup in `#root`, its `head` ahead of the shell's `<title>`, its `css` as a `<style>`. The client hydrates a page prerendered for its path and renders anything else fresh. `--no-html` / `{ html: false }` opts out; a failure of the whole step - no empty `<div id="root">` in the shell, a bundle that will not load, a throwing `paths()` - warns and keeps the client-only build.

- Rendered: every page with no `[param]` or `[...]` above it, plus what `paths()` lists below one. A listed path no route matches warns and is skipped.
- Server-bound pages stay in the browser - the build never runs server code. During a page's render, calling an `api/` call (`new()` included) aborts that page alone, counted in the summary. A call from an event handler or effect never runs, so its page still renders. A default class or `Layout` that calls the server leaves every page below to the browser. A `paths()` that calls the server lists nothing.
- A page that throws `Redirect` or `NotFound` stays client-rendered and is counted once in the summary. Rendering nothing, another throw or taking over 30s warns per page. A default class awaits `new()` before render; its rejection fails the page. A class built during render may reject later and warn.
- `new()` runs at build and effects do not - DOM listeners and browser-only reads belong in effects. `typeof window` detects the build (`import.meta.env.SSR` is false); a module reading `window` or `document` at load fails the whole step.
- The empty shell is kept as `200.html`; the built service serves `<path>/index.html`, then it. A static host should fall back to `200.html`. One that falls back to the root `index.html` (Cloudflare Pages without a `404.html`) still boots the right page, after showing the home page until scripts load.

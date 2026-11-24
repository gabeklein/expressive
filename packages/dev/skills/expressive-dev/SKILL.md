---
name: expressive-dev
description: Expressive app host (@expressive/dev) - expressive dev and dev build over Vite with @expressive/dom, a generated route tree, inspect and rpc. Use when working in an @expressive/dev app - layout, route modules, sidecars, server Model and gates, commands.
---

# @expressive/dev

App host: `expressive dev` and `expressive dev build` over Vite, rendering with `@expressive/dom`, routing with `@expressive/router` from a generated tree, `@expressive/inspect` on the dev server, server calls through `@expressive/rpc`.

```bash
npm install @expressive/dev @expressive/mvc
```

tsconfig: `"jsxImportSource": "@expressive/dev"` - dom's runtime and its `Model` augmentation.

`@expressive/dev` exports `Route`, `Router` and `NotFound`, and re-exports `Link`, `NavLinks` and `Redirect` from `expressive-router` and `render`, `style`, `Css`, `Style`, `Portal`, `Fragment`, `createElement` and `JSX` from `expressive-dom`. `Model`, `Component` and instructions come from `@expressive/mvc`. The dev server's inspector is `expressive-inspect`. Per-symbol contracts are JSDoc on hover.

## Layout

```
app/                  file-based routes
  index.tsx           /            exports: Page, Layout, Loading, Catch, NotFound, label, Router, default
  (about).tsx         /about       static leaf
  blog/index.tsx      /blog        folder = scope; its index is the page
  blog/[slug].tsx     /blog/:slug  param leaf
  docs/[...].tsx      /docs/*      catch-all
  blog/remote.ts      sidecar      server module for /blog and below
  blog/remote/        sidecar      or a folder of them, any depth
app.tsx | src/app.tsx single root component instead of app/ (default export)
index.ts              optional server entry: export default config({ port, handle, target, host })
index.html            optional shell (#root and the entry script injected if missing)
vite.config.ts        optional, merged under the host's
.env, .env.*          optional - see Environment
```

Bare-named files under `app/` are support modules. Siblings match static before `:param` before `*`.

## Route modules

- `Page` - a function (params via `Route.get().match`) or `class Page extends Route` (from `@expressive/dev`) with `this.match`, fields and `render()`.
- `Layout` - wraps the folder's pages; `children` is the content slot.
- `Loading` - placeholder for the slot of the `Layout` beside it, for any page below still loading code, an entry hook or data, until a nested `Layout`. A page's own `Loading` covers it first. Shown on cold arrival only - in-app navigation holds the current page (`Router.get().navigating`).
- `Catch` - error boundary for the route, given `{ error, retry }`.
- `NotFound` - replaces the default 404 below the folder.
- `label` - names the route for breadcrumbs (`Route.get().parent.label`). `const` string literal only - inlined into the tree; anything else fails generation. A folder's `index.tsx` labels the folder - or, with no other routes inside, the one route it collapses to (`Route.get().label`). In dev, an edit shows after a restart.
- `Router` - root `index.tsx` only: a subclass of `Router` from `@expressive/dev` (not router's `BrowserRouter`), mounted in its place - override `navigate()`, add methods. `Router.get()` and the subclass's `get()` both find it. Prerendering constructs it and runs `new()` without `window` - guard what touches it there.
- `default`, read by kind:
  - a function is the entry hook: runs with the Route before render, may be async; a returned string redirects, `null` falls through to the 404. A thrown error with a 3xx `status` and `location` redirects; any other reaches `Catch`.
  - a Model or Component class renders around the content (around `Layout` if present) and is provided below.
- `paths` - below a `[param]` or `[...]`, the absolute paths a prerendering build renders; may be async. Bundled with the client - no Node APIs; use static imports, `import.meta.glob` or an absolute-URL `fetch`.

Each module is its own chunk, loaded on first entry, unless it is the root or exports `Loading` or `Catch`.

## Sidecars

A `remote.ts` beside a route runs on the server. Exports are `async` functions; the route's code imports them and gets stubs.

```ts
// app/tally/remote.ts
let total = 0;
export async function add(by: number) { return (total += by); }
```

```tsx
// app/tally/index.tsx
import { add } from "./remote";
```

- A call POSTs to the folder's path, params filled from the current location (`/blog/a` for `app/blog/[slug]/remote.ts`).
- Only the folder and those below it may import its sidecar - the build throws otherwise.
- A `remote/` folder holds several; every module in it belongs to the parent folder and is never a route.
- Module rules, errors (`HttpError` family from `@expressive/rpc`), ids and `opaque` are rpc's - `expressive-rpc`. Turn off hashed ids with `config({ remote: { opaque: false } })` in `index.ts`.
- Only stubs the client loaded (dev) or the build generated are callable; a helper in `remote/` is never an endpoint.

## Server Model

Inside a call, `X.get()` finds the nearest server Model at the call's location or above; it throws outside a call. A folder's remote entry (`remote.ts` or `remote/index.ts`) may default-export a function - the folder's gate, run before each call through the folder. It refuses by throwing, or by activating a Model whose `new()` fails; each call waits for the Models it activates, found by `get()` in the call and dropped after. It stays on the server; the client imports only the folder's functions. Every entry's default is checked at build, and in dev on each call through its folder, imported or not - a class or other value fails.

```ts
class Account extends Model {
  user?: User = undefined;

  protected async new() {
    const { session } = AppCookies.get();
    if (!session) throw new Unauthorized("Sign in.");
    this.user = await db.user(session);
  }
}

export default () => void Account.new();

export async function profile() {
  return Account.get().user;
}
```

- `key()`/`ttl` belong to rpc's class gates (`expressive-rpc/SKILL.md`); dev no longer reads them.
- `Cookies` (from `@expressive/dev/server`, as in rpc): a subclass declares cookies as fields; `AppCookies.get()` reads this request's and `AppCookies.set({ ... })` sends `Set-Cookie` with the reply. `Current` is the lower level: `.request`, `.url`, `.cookies`, read-only, and `setHeader(name, value)`.
- Process-wide state: a module-level `X.new(Context.root)`, found by `get()` from any call.

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

Nothing is written into the project - the shell, entry and route tree are virtual under `/.expressive/`. `@expressive/dev/vite` exports `expressive()` for a hand-written Vite config - add `inspect()` from `@expressive/inspect/vite` beside it for the relay. Server code runs on Vite's module runner in dev, with Node's `import.meta`.

## Server entry

`index.ts` default-exports `config({ ... })` from `@expressive/dev` - identity, types the settings: `target`, `port`, `remote`, `handle`, `host`. Any other key fails dev and the build by name.

`handle({ request, env, ctx, next })` is fetch middleware around every request the host forwards - remote calls, pages, static files. Return a `Response` to answer, nothing to pass.

```ts
// index.ts - db is SQLiteConnection.new(types, "app.db"), skill expressive-sql
export default config({
  handle: ({ next }) => db.session(next),
});
```

- Nothing returned: `next()`'s reply if called, else `next()` is called. Other return values throw. `next()` once, and only until `handle` returns.
- `next(request)` forwards a rewrite; a non-`Request` argument throws - wrap callbacks: `db.transaction(() => next())`. Read the body through `request.clone()` to still pass it on.
- `next()` resolves a `Response` with mutable headers (101 as is); a throw below resolves its error reply. A discarded reply's body is cancelled.
- Outside the request's scope: `Current`, `Cookies`, `get(Model)` throw in `handle`, work inside `next()`. Cookies go on the returned `Response`; after-work through `ctx.waitUntil`.
- A thrown `HttpError` answers its status - a call's error on a call, else JSON `{ message }` (`Redirect` sets `Location`). Else a logged 500, message in dev only.
- Below it: a remote call, else the page - Node: file, `<path>/index.html`, shell from `dist/client`, else 404. Dev: a `public/` file, else the shell for a navigation. `fetch` target: 404.
- Dev skips it for Vite's requests: outside `base`, `/@vite/*`, `/@id/*`, `/@fs/*`, `/node_modules/*`, `/.expressive/*` but calls, `/__inspect`, `/__open-in-editor`, `server.proxy` prefixes, bare `?import`/`?url`/`?raw`, source files outside `public/`. A passed request that is neither file nor navigation continues to Vite's middlewares with `handle`'s headers and forwarded request.

`env` - the host's bindings, `{}` on Node and in dev. Type it: `declare module "@expressive/dev" { interface Env { API_KEY: string } }`.

Tests: `compose(settings)` from `@expressive/dev/server` - the app without remotes, pages from a stub: `await compose(settings)(new Request("http://x/a"), { assets: { fetch: async () => new Response(shell) } })`.

## Fetch target

`config({ target: "fetch" })` builds `dist/server/index.js` as a module, every dependency bundled, for a host that calls its default export's `fetch(request, env, ctx)`.

- `host(app)` returns the default export - platform handlers (`scheduled`) go there; without `fetch` it gets `{ fetch: (request, env, ctx) => app(request, { env, ctx }) }`. Dev never calls it; on Node it fails the build.
- `env` is the host's second `fetch` argument - in `handle` and `Current.get().env`.
- Named exports of `index.ts` are re-exported - listed ones, not `export *`; types need `export type`.
- `index.ts` also loads in Node (build, dev) - import host-only modules lazily, list them in `vite.config.ts`'s `build.rollupOptions.external`; resolve conditions go there too.
- Folder gates do not run: a remote entry with a default fails the build, and in dev the calls below it. Remote functions only.
- The bundle imports `node:async_hooks` and `node:crypto`.
- No boot file - `.env` does not fill `process.env`; the host's bindings are the environment.

Cloudflare Workers with static assets - a D1 session per request, the shell for client routes from `ASSETS`, a cron:

```ts
// index.ts - d1 is app code wrapping a D1 binding in sql's Engine
import { config, type Env } from "@expressive/dev";

declare module "@expressive/dev" { interface Env { ASSETS?: Fetcher; DB: D1Database } }

export default config({
  target: "fetch",
  handle: ({ request, env, next }) => db.session(async () => {
    const reply = await next();
    if (reply.status !== 404 || !env.ASSETS || request.method !== "GET") return reply;

    const found = await env.ASSETS.fetch(request);
    if (found.status !== 404) return found;

    for (const shell of ["/200", "/"]) {
      const page = await env.ASSETS.fetch(new URL(shell, request.url));
      if (page.ok) return page;
    }

    return reply;
  }, d1(env.DB)),
  host: () => ({
    scheduled: (event: ScheduledController, bound: Env) => db.session(() => sweep(), d1(bound.DB)),
  }),
});
```

`wrangler.jsonc`: `"main": "dist/server/index.js"`, `"compatibility_flags": ["nodejs_compat"]`, `"assets": { "directory": "dist/client", "binding": "ASSETS", "run_worker_first": ["/*", "!/assets/*"] }`. Without `run_worker_first` a call to a path with a file (a root remote's, `/`) gets 405. Leave `not_found_handling` unset - single-page mode serves the prerendered home page for client routes.

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

- Rendered: every page with no `[param]` or `[...]` above it, plus what `paths()` lists below one - unchecked against the routes, so an unmatched path writes the 404 page.
- Server-bound pages stay in the browser, wherever their remote sits - the build never runs server code. During a page's render, calling a remote function (`new()` included) aborts that page alone, counted in the summary. A call from an event handler or effect never runs, so its page still renders. An entry hook or `Layout` that calls the server leaves every page below to the browser. A `paths()` that calls the server lists nothing.
- A page that redirects, renders nothing, throws or takes over 30s is skipped with a warning.
- `new()` runs at build and effects do not - DOM listeners and browser-only reads belong in effects. `typeof window` detects the build (`import.meta.env.SSR` is false); a module reading `window` or `document` at load fails the whole step.
- The empty shell is kept as `200.html`; the built service serves `<path>/index.html`, then it. A static host should fall back to `200.html`. One that falls back to the root `index.html` (Cloudflare Pages without a `404.html`) still boots the right page, after showing the home page until scripts load.

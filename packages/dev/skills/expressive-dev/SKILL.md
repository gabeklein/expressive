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
index.ts              optional server entry: export default config({ port, fetch, around, target })
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

## App routes

`config({ fetch(request, env, ctx) { ... } })` in `index.ts` answers after remote calls, before static files; return nothing to fall through. Runs in the request's scope - `Current`, `Cookies` work. On Node `env` is `{}`. In dev it also sees Vite's requests (`/@vite/client`, `/.expressive/*`) - match the paths it answers.

`fetch`'s fourth argument `next()` resolves what the request gets without `fetch` - return or rewrite it (a page's `<head>` for link previews); read, return or cancel its body. Node: file, `<path>/index.html` or shell from `dist/client`, else 404. Dev: a `public/` file, else the shell Vite transforms - never Vite's modules. `fetch` target: 404 - take the page from the host's assets, `?? next()` in dev, and drop `content-length` and `etag` when rewriting.

## Request scope

`config({ around(next, { request, env, ctx }) { ... } })` wraps each remote call and `config.fetch` on every host (Node, `fetch` target, dev) - run `next` inside the request's context and resolve what it resolves. Runs around the call's scope - read `scope.request`, not `Current`. With `config.fetch`, every non-call request runs inside it, including those `fetch` passes on (in dev, Vite's); without, only calls. The fetch target's other handlers (`scheduled`) skip it - wrap those in the handler. The scope ends when `next` resolves - `ctx.waitUntil` work and streamed bodies run after. A throw on a call replies as a call's error; on `fetch` it reaches the host.

An `@expressive/sql` session per request (skill `expressive-sql`) - its own identity map:

```ts
// index.ts - db is SQLiteConnection.new(types, "app.db")
export default config({
  around: next => db.session(next),
});
```

## Fetch target

`config({ target: "fetch" })` builds `dist/server/index.js` as `export default { fetch }`, every dependency bundled, for a host that calls a module's `fetch`: remote calls, then `config.fetch`, else 404. Static files are the host's - `config.fetch` forwards to them.

- `Current.get().env` - the host's second `fetch` argument. Type it: `declare module "@expressive/rpc" { interface Env { API_KEY: string } }`, with `@expressive/rpc` a dependency of the app.
- Dev: `export async function bindings()` in `index.ts` returns `env` - once per server, again after a throw. Dropped from the build - import what it needs inside it: `export const bindings = async () => (await import("./dev-env")).env();`.
- Other config members join the default export (`scheduled`); listed named exports of `index.ts` but `bindings` are re-exported - not `export *`; types need `export type`.
- `index.ts` also loads in Node (build, dev) - import host-only modules lazily, list them in `vite.config.ts`'s `build.rollupOptions.external`; resolve conditions go there too.
- The bundle imports `node:async_hooks` and `node:crypto`.
- No boot file - `.env` does not fill `process.env`; the host's bindings are the environment.

Cloudflare Workers with static assets, for example - `fetch` forwards to `ASSETS` and serves the shell for client routes:

```ts
// index.ts
import { config } from "@expressive/dev/server";

declare module "@expressive/rpc" { interface Env { ASSETS?: Fetcher } }

export default config({
  target: "fetch",
  async fetch(request, env) {
    const found = await env.ASSETS?.fetch(request); // undefined in dev - Vite answers
    if (found?.status !== 404 || request.method !== "GET") return found;

    for (const shell of ["/200", "/"]) {
      const page = await env.ASSETS!.fetch(new URL(shell, request.url));
      if (page.ok) return page;
    }

    return found;
  },
});
```

`wrangler.jsonc`: `"main": "dist/server/index.js"`, `"compatibility_flags": ["nodejs_compat"]`, `"assets": { "directory": "dist/client", "binding": "ASSETS", "run_worker_first": ["/*", "!/assets/*"] }`. Without `run_worker_first` a call to a path with a file (a root remote's, `/`) gets 405. Leave `not_found_handling` unset - single-page mode serves the prerendered home page for client routes.

Session on a D1 binding there: `around: (next, { env }) => db.session(next, d1(env.DB))` - `d1` is app code wrapping a D1 binding in sql's `Engine` and passing an `Engine` through; `db` has no source; `scheduled` opens its own: `scheduled: (event, env) => db.session(() => sweep(), d1(env.DB))`. Dev: `bindings()` returns `{ DB: await sqlite("local.db", { migrations: "migrations" }) }` (`sqlite` from `@expressive/sql`, imported inside `bindings`).

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

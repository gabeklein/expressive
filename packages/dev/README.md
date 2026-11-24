# @expressive/dev

`expressive dev` and `expressive dev build` for an Expressive app: Vite underneath, `@expressive/dom`
as the renderer, `@expressive/router` for the tree that `app/` generates, and `@expressive/inspect`
on the dev server.

## Project layout

```
app/                  file-based routes
  index.tsx           /            exports: Page, Layout, Loading, Catch, NotFound, label, Router, default
  (about).tsx         /about       static leaf
  blog/index.tsx      /blog        folder = scope; its index is the "/blog" page
  blog/[slug].tsx     /blog/:slug  param leaf
  docs/[...].tsx      /docs/*      catch-all
  blog/remote.ts      sidecar      server module for /blog and below
  blog/remote/        sidecar      or a folder of them, any depth, index optional
app.tsx | src/app.tsx single root component instead of app/ (default export)
index.ts              optional service entry, run on the server: export default config({ port })
index.html            optional custom shell (#root and the entry script are injected if missing)
vite.config.ts        optional, merged under the host's config
```

Bare-named files under `app/` are support modules, not routes. `Page` may be a function, reading
its params through `Route.get().match`, or `class Page extends Route` (from `@expressive/dev`) with
`this.match`, its own fields and `render()`. That is the one intended use of `Route` - folders
express nesting. dev's `Route` owns no suspense boundary unless given a `fallback` or `Catch`, so a
page's waits show its slot's `Loading`.

The `default` export is read by kind. A function is the entry hook: it runs with the Route before
it renders, and a returned string redirects (`null` falls through to the 404). A class - Model or
Component - renders around the route's content and is provided to everything below it; with a
`Layout`, it wraps the `Layout`.

`Loading` is the placeholder for the content slot of the `Layout` beside it: any page rendered
there that cannot show anything yet - its code, its entry hook or its data still pending - shows
it in place, inside the layout. It reaches pages at any depth until a nested `Layout`, which starts
its own slot. A page's own `Loading` covers that page first. Navigation inside the app never shows
it - the current page holds until the next is ready (`Router.get().navigating` meanwhile); it is
for arriving cold, by link or refresh. A Component or a Model with its own `fallback` keeps its
waits to itself.

`label` names the route for breadcrumbs (`Route.get().parent.label`). It must be a `const` string
literal (`export const label = "Blog"`) - the generated tree inlines it, so a lazy module's label is
on hand before its chunk loads; anything else fails generation. A leaf labels itself, a folder's
`index.tsx` its folder: the parent of its page, or, with no other routes inside, the one route it
collapses to - its page's own `Route.get().label`. In dev, an edited label shows after a restart.

The root `index.tsx` may export `Router`, a subclass of dev's `Router`, mounted in its place - to
override `navigate()` for View Transitions, or add methods. Subclass dev's, not router's
`BrowserRouter`: both `Router.get()` and the subclass's `get()` then find it, and prerendering
records where it lands. Prerendering constructs it and runs `new()` without `window` - guard what
touches it there.

Each route module becomes its own chunk, loaded when the route is first entered - `default`
included - unless it is the root or exports `Loading` or `Catch`, which must be on hand before
anything below them can wait or fail.

JSX compiles against `@expressive/dev`'s runtime, which is `@expressive/dom`'s. Set
`"jsxImportSource": "@expressive/dev"` in the app's tsconfig; the types carry dom's `Model`
augmentation (`Model.get()` and friends), so nothing else is needed.

## Server

`index.ts` runs on the server - in dev on Vite's module runner, in production inside
`dist/server/index.js`, which serves `dist/client` (with `public/`, copied only there) and falls back
to `index.html` for client routes.
It imports `config` from `@expressive/dev/server`: `port`, `remote.opaque` (below), `fetch`,
`around` and `target`.

### App routes

```ts
// index.ts
import { config } from "@expressive/dev/server";

export default config({
  async fetch(request) {
    if (new URL(request.url).pathname === "/health") return new Response("ok");
  },
});
```

`fetch(request, env, ctx)` answers after remote calls and before static files; returning nothing
falls through. It runs in the request's scope - `Current` and `Cookies` work as in a call. In dev it
also sees Vite's own requests (`/@vite/client`, `/.expressive/*`), so match only the paths it
answers. On Node, `env` is `{}`.

`next()`, its fourth argument, resolves what the request gets without `fetch` - to return as is or
rewrite, such as a page's `<head>` for link previews. Read, return or cancel its body.

- Node: the file, the page's `<path>/index.html` or the shell from `dist/client`, else 404.
- Dev: a file from `public/`, else the shell as Vite transforms it - never Vite's modules, so return
  nothing for those.
- The `fetch` target: 404 - static files are the host's there (below).

```ts
export default config({
  async fetch(request, env, ctx, next) {
    if (!new URL(request.url).pathname.startsWith("/invite/")) return;

    const page = await next();
    const html = (await page.text()).replace("</head>", `<meta property="og:title" content="Join"></head>`);

    return new Response(html, page);
  },
});
```

### Request scope

`around(next, scope)` wraps each remote call and the app's `fetch` on every host - Node, the
`fetch` target and dev. Run `next` inside whatever the request needs, such as a database session,
and resolve what it resolves. `scope` holds `request`, `env` and `ctx`. It runs around the call's
scope, so read the request from `scope.request`, not `Current`.

- With a `fetch`, every request that is not a call runs inside it, including those `fetch` passes
  on - in dev, Vite's too. Without one, only calls do.
- The fetch target's other handlers (`scheduled`) skip it - wrap those in the handler.
- The scope ends when `next` resolves: `ctx.waitUntil` work and a streamed body run after it.
- A throw or rejection on a call replies as a call's error would - an error class a remote exports
  keeps its status, anything else is a 500. On `fetch` it reaches the host, as a throw in `fetch` does.

```ts
import { config } from "@expressive/dev/server";
import { db } from "./db";   // SQLiteConnection.new(types, "app.db")

export default config({
  around: next => db.session(next),
});
```

With `@expressive/sql`, each request gets its own identity map. A session can also take the
request's database as its second argument - see the fetch target below.

### Deploying to a fetch host

`config({ target: "fetch" })` builds `dist/server/index.js` as `export default { fetch }` with
every dependency bundled - for a host that calls a module's `fetch` rather than running a server. A
request goes to remote calls, then the app's `fetch`, else 404. Static files are the host's: the
app's `fetch` forwards to them.

- `env` is the host's second `fetch` argument, and `Current.get().env` anywhere in the request.
  Type it by extending rpc's `Env` - `declare module "@expressive/rpc" { interface Env { API_KEY:
  string } }` - with `@expressive/rpc` a dependency of the app.
- In dev, `export async function bindings()` in `index.ts` supplies `env`: once per server, again
  after a throw. The build drops it - import what it needs inside it, so that goes too:
  `export const bindings = async () => (await import("./dev-env")).env();`
- The config's other members join the default export (a `scheduled` handler, say), and `index.ts`'s
  named exports other than `bindings` are re-exported - listed ones only, not `export *`; export
  types with `export type`.
- `index.ts` also loads in Node, at build and in dev - import a module only the host resolves lazily,
  and list it in `build.rollupOptions.external` of `vite.config.ts`. Resolve conditions go there too.
- The bundle imports `node:async_hooks` and `node:crypto` (rpc's request scope).

Cloudflare Workers with static assets, for example: `fetch` forwards to the `ASSETS` binding and
serves the shell for client routes, as the Node server does.

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

`wrangler.jsonc` sets `"main": "dist/server/index.js"`, `"compatibility_flags": ["nodejs_compat"]`
and `"assets": { "directory": "dist/client", "binding": "ASSETS", "run_worker_first": ["/*",
"!/assets/*"] }`. Without `run_worker_first`, a call posted to a path with a file (a root remote's,
to `/`) gets 405 from the assets. Leave `not_found_handling` unset - its single-page mode serves the
prerendered home page for client routes.

To rewrite a page there, take the shell from the assets (`/200`, or `/` under `--no-html`), with
`next()` for dev, and drop the length and validator a rewrite makes stale:

```ts
const page = await (env.ASSETS?.fetch(new URL("/200", request.url)) ?? next());
const headers = new Headers(page.headers);

headers.delete("content-length");
headers.delete("etag");

return new Response(rewrite(await page.text()), { status: page.status, headers });
```

A session per request on a D1 binding there, through `around`:

```ts
import { config } from "@expressive/dev/server";
import { db } from "./db";   // SQLiteConnection.new(types) - no source
import { d1 } from "./d1";   // the app's adapter from a D1 binding to sql's Engine
import { sweep } from "./jobs";

export async function bindings() {
  const { sqlite } = await import("@expressive/sql");
  return { DB: await sqlite("local.db", { migrations: "migrations" }) };
}

export default config({
  target: "fetch",
  around: (next, { env }) => db.session(next, d1(env.DB)),
  scheduled: (event, env) => db.session(() => sweep(), d1(env.DB)),
});
```

`d1` is app code: it wraps a D1 binding in sql's `Engine` (`all`, `get`, `run`, `exec`, `close`) and
passes an `Engine` through, so dev's `sqlite()` file - migrated on first use - serves unchanged.
`scheduled` is outside `around`, so it opens its own session.

### Sidecars

A `remote.ts` in a route folder runs on the server. Each export is an `async` function; the browser
imports a stub that calls it. For more than one module, use a `remote/` folder instead: every module
in it, at any depth, belongs to the parent folder - `app/blog/remote/feed/latest.ts` runs for `/blog`,
and `remote/` is never a route.

```ts
// app/tally/remote.ts
let total = 0;
export async function add(by: number) { return (total += by); }
```

```tsx
// app/tally/index.tsx
import { add } from "./remote";
```

A call is `POST` to the folder's path with its params filled from the current location (`/blog/a`
for `app/blog/[slug]/remote.ts`), an `x-expressive-call` header naming the function (`add`, or
`feed/latest:add` inside `remote/`), and the arguments as a JSON array. The reply is `{ value }`.
Only the folder and those below it may import its sidecar.

Only what the client imports is callable: the server accepts calls to the stubs the browser loaded in
dev, and to those the client build generated in production - a helper module in `remote/` is never
an endpoint. Remote calls are not a public API. The production build names each call by a hash
unique to the build, so a stale tab fails rather than calling changed code; `remote: { opaque: false }`
in `index.ts` keeps readable names, for clients that must outlive a deploy.

A sidecar may also export `Error` subclasses. Thrown on the server, one rejects the call on the
client as the same class - `instanceof` works - with its message and own fields; a numeric
`status` field in 400-599 sets the reply's status (409 below, else 500); a 3xx `status` with a
`location` field redirects an entry hook that awaits the call and replies 500. Any other thrown error
rejects with its message in dev and a generic one in production.

```ts
export class Overflow extends Error {
  status = 409;
  constructor(public limit: number) { super(`The tally stops at ${limit}.`); }
}
```

The build refuses any other export, since the client could not use it: a sync function, a value, a
re-export, a class without `extends`, or a Model class. A default is the folder's gate (below). A
class whose base is not an `Error` fails its first call in dev and the built service at startup.

### Server Model

A folder's remote entry (`remote.ts` or `remote/index.ts`) may default-export a function - the
folder's gate, run before each call through the folder. It refuses the call by throwing, or by
activating a Model whose `new()` fails. A call waits for each Model the gate activates; `X.get()`
finds them in that call and the folder's calls below, and they are dropped after it. `X.get()`
throws outside a call. A gate stays on the server: the client imports its folder's functions, never
the gate. Every remote entry's default is checked at build, and in dev on each call through its
folder, imported by the client or not - a class or any other value fails.

`@expressive/rpc`'s class gates (`static key()`, `static ttl`) are not read by dev.

```ts
// app/account/remote.ts
import { Cookies } from "@expressive/dev/server";

class AppCookies extends Cookies {
  session?: string = undefined;
}

export class SignIn extends Error {
  status = 302;
  location = "/login";
}

class Account extends Model {
  user?: User = undefined;

  protected async new() {
    const { session } = AppCookies.get();
    if (!session) throw new SignIn("Sign in first.");
    this.user = await db.user(session);
  }
}

export default () => void Account.new();

export async function admin() {
  return Account.get().user!.admin;
}
```

```tsx
// app/account/index.tsx
import { admin } from "./remote";

export default async () => ((await admin()) ? undefined : "/");
```

A refused call rejects with the gate's error: from an entry hook, one carrying a 3xx `status` and a
`location` redirects there, and anything else reaches the nearest `Catch`.

`Current` (from `@expressive/dev/server`) is the request in progress, readable from any server
Model or function in a call: `Current.get().url`, `.cookies`, `.request` (a Web `Request`), and `setHeader` for
that call's reply. Cookies the app uses are better declared as a `Cookies` subclass (see below). Its accessors read the
call live, so a reused instance may hold it in a field (`current = get(Current)`) but should not
copy its values into its own.

## Commands

```
expressive dev                  Vite dev server with HMR and inspect's /__inspect relay
expressive dev --no-inspect     without the relay
expressive dev --port <n>       listen on <n> - over index.ts's port and Vite's
expressive dev build            dist/client (static app) and dist/server/index.js (node service, or fetch handler)
expressive dev build --pretty   unminified client, stable filenames
expressive dev build --no-html  without prerendered pages
expressive help [command]       commands, or one command's inputs
node dist/server/index.js       run the built service (port from index.ts, default 3000)
```

Nothing is written into the project. The shell, the client entry and the generated router module
are virtual, addressed under `/.expressive/`. The router module regenerates when files appear or
vanish under `app/`, or an edit changes what it generates.

`@expressive/dev/vite` exports the `expressive()` plugin for a hand-written Vite config; the CLI
adds it and `@expressive/inspect/vite`. It also exports `runBuild`, which the CLI's build calls.
Server-only API - `config`, `serve`, `Current` - is `@expressive/dev/server`; the generated server
entry imports `serve` from there. Under `target: "fetch"` it calls `@expressive/dev/fetch` instead - the
generated entry's runtime, not an API to call by hand.

### Prerendering

`expressive dev build` renders each page in Node with `renderToString` from
`@expressive/dom/server` after the build, and writes it to `dist/client/<path>/index.html`: the
markup goes in `#root`, its hoisted `<title>`, `<meta>` and `<link>` go ahead of the shell's own
`<title>`, and the style rules it used go in a `<style>`. The client hydrates a page prerendered
for its own path, adopting the markup in place, and renders anything else fresh.

`--no-html` (or `runBuild(root, { html: false })`) leaves every page to the browser. If
prerendering fails as a whole - a shell without an empty `<div id="root">`, a bundle that will not
load, a `paths()` that throws - the build warns and keeps the client-only output.

Only pages that need nothing at request time are rendered. A `[param]` or `[...]` route is skipped
unless its module exports `paths()`, returning the absolute paths to render:

```tsx
// app/blog/[slug].tsx
const posts = import.meta.glob("../../posts/*.md");

export const paths = () => Object.keys(posts).map(file => `/blog/${file.split("/").pop()!.slice(0, -3)}`);
```

`paths()` is bundled with the client code, so it has no Node APIs - list from static imports,
`import.meta.glob` or an absolute-URL `fetch`. Its paths are not checked against the routes: one
no route matches writes the 404 page.

A page that needs the server while it renders stays client-rendered, wherever its `remote.ts` or
`remote/` sits, and the build never runs server code. In the build, remote stubs stop at the server:
calling a remote function aborts that page's render
and leaves that page to the browser, counted in the build's summary. So a `remote/` at the root of
`app/`, shared by many screens, still lets `/privacy` and `/terms` prerender, while a dashboard that
loads its data on render does not.

- A call from `new()` counts; one from an event handler or effect never runs.
- An entry hook or `Layout` that calls the server leaves every page below it to the browser.
- A `paths()` that calls the server lists nothing.

A page that redirects, renders nothing, throws or takes over 30 seconds is skipped with a warning.

`new()` runs during the render and effects never do, so DOM listeners and browser-only reads
belong in effects; `typeof window` tells the build apart, since `import.meta.env.SSR` is false
there. A module that reads `window` or `document` at load fails the step, leaving every page to
the browser.

The empty shell is kept as `dist/client/200.html`. The built service serves `<path>/index.html`,
then falls back to the shell, and a static host should fall back to `200.html` too. A host that
falls back to the root `index.html` (Cloudflare Pages without a `404.html`) serves the prerendered
home page there. The client notices the page was rendered for another path and renders the right
one, but the home page shows until scripts load.

## Example

`example/` is a routed app, typechecked with the package. Running it needs a build: after
`bun run build` at the repo root, `bun run example`, `bun run example:build` or
`bun run example:start` here.

`bun run example:e2e` here runs its Playwright specs (`example/e2e/`) against both the dev server
and the built service, after `bun run build` at the root. Set `CHROME` to use a local Chromium
binary.

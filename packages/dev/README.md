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
index.ts              optional server entry: export default config({ port, handle, target, host })
index.html            optional custom shell (#root and the entry script are injected if missing)
vite.config.ts        optional, merged under the host's config
```

Bare-named files under `app/` are support modules, not routes. `Page` may be a function, reading
its params through `Route.get().match`, or `class Page extends Route` (from `@expressive/dev`) with
`this.match`, its own fields and `render()`. That is the one intended use of `Route` - folders
express nesting. dev's `Route` owns no suspense boundary unless given a `fallback` or `Catch`, so a
page's waits show its slot's `Loading`.

The `default` export is read by kind. A function is the entry hook: it runs with the Route before
it renders, and a returned string redirects (`null` falls through to the 404). In a folder with a
seat, it runs once the seat's twin is fetched (Entry, below). A class - Model or
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
to `index.html` for client routes. Its default export is `config({ ... })` from `@expressive/dev`,
an identity function that types the settings: `target`, `port`, `remote.opaque` (below), `handle`
and `host`. Any other key fails the dev server and the build by name.

### handle

`handle({ request, env, ctx, next })` is fetch middleware around every request the host forwards:
remote calls, pages and static files. Return a `Response` to answer, or nothing to pass. `next()`
runs the app below and resolves its reply - to return, rewrite or wrap:

```ts
// index.ts
import { config } from "@expressive/dev";
import { db } from "./db";

export default config({
  handle: ({ next }) => db.session(next),
});
```

- Returning nothing passes through `next()`'s reply if it was called, else calls it. Anything else
  returned throws. `next()` runs once, and only until `handle` returns.
- `next(request)` forwards a rewritten request. Anything other than a `Request` throws, so a wrapper
  that calls back with its own value (`db.transaction(next)`) fails loudly - wrap it: `() => next()`.
  To read the body and still pass it on, read `request.clone()`.
- `next()` resolves a `Response` with mutable headers (a 101 upgrade as is); a throw below resolves
  its error reply rather than rejecting. A reply `handle` discards has its body cancelled.
- `handle` runs outside the request's scope: `Current`, `Cookies` and `get(Model)` throw there, and
  work inside `next()` - `db.session(next)` encloses all of it. Cookies go out on the `Response` it
  returns; work after the reply goes through `ctx.waitUntil`.
- A thrown `HttpError` answers its status - on a call as the call's error, else JSON `{ message }`
  (`Redirect` sets `Location`). Anything else is logged and answered with a 500 whose message shows
  in dev only.
- Below `handle`: a remote call, else the page or file - on Node, the file, `<path>/index.html` or the
  shell from `dist/client`, else 404; in dev, a `public/` file, else the shell for a navigation; on
  the `fetch` target, 404 (static files are the host's, below).
- In dev, Vite's own requests skip it: paths outside `base`, `/@vite/*`, `/@id/*`, `/@fs/*`,
  `/node_modules/*`, `/.expressive/*` other than calls, `/__inspect`, `/__open-in-editor`,
  `server.proxy`'s prefixes, the bare `?import`, `?url` and `?raw` flags, and source files under
  the root outside `public/`. A request it passes that is neither a file nor a navigation goes on to
  Vite's middlewares, with the headers `handle` added and the request it forwarded.

`env` is the host's bindings - `{}` on Node and in dev. Type it on `@expressive/dev`:
`declare module "@expressive/dev" { interface Env { API_KEY: string } }`.

`compose(settings)` from `@expressive/dev/server` builds the app without a server, for tests -
no remotes; pages come from a stubbed `assets`:

```ts
import { compose } from "@expressive/dev/server";
import settings from "../index.ts";

const app = compose(settings);
const page = await app(new Request("http://x/invite/abc"), { assets: { fetch: async () => new Response(shell) } });
```

### Deploying to a fetch host

`config({ target: "fetch" })` builds `dist/server/index.js` as a module with every dependency
bundled, for a host that calls its default export's `fetch(request, env, ctx)` rather than running
a server.

- `host(app)` returns that default export, for platform handlers dev does not model; one without
  `fetch` gets `{ fetch: (request, env, ctx) => app(request, { env, ctx }) }`. Dev never calls it, and
  on the Node target it fails the build.
- `env` is the host's second `fetch` argument, as `handle` and `Current.get().env` read it.
- `index.ts`'s named exports are re-exported (Durable Object classes) - listed ones only, not
  `export *`; export types with `export type`.
- `index.ts` also loads in Node, at build and in dev - import a module only the host resolves lazily,
  and list it in `build.rollupOptions.external` of `vite.config.ts`. Resolve conditions go there too.
- Requests keep no state between them: a remote that default-exports a seat or exports a Model class
  fails the dev server and the build. Remote functions only.
- The bundle imports `node:async_hooks` and `node:crypto` (rpc's request scope).

Cloudflare Workers with static assets, for example - a cron, a session per request on a D1 binding,
and pages from the `ASSETS` binding with the shell for client routes:

```ts
// index.ts
import { config, type Env } from "@expressive/dev";
import { db } from "./db";   // SQLiteConnection.new(types) - no source
import { d1 } from "./d1";   // the app's adapter from a D1 binding to sql's Engine
import { sweep } from "./jobs";

declare module "@expressive/dev" { interface Env { ASSETS?: Fetcher; DB: D1Database } }

export default config({
  target: "fetch",
  handle: ({ request, env, next }) => db.session(async () => {
    const reply = await next();
    if (reply.status !== 404 || !env.ASSETS || request.method !== "GET") return reply;

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

`next()` answers the calls; the 404 below it falls to the assets. `scheduled` runs outside any
request, so it reads the platform's `env` argument and opens its own session.

`wrangler.jsonc` sets `"main": "dist/server/index.js"`, `"compatibility_flags": ["nodejs_compat"]`
and `"assets": { "directory": "dist/client", "binding": "ASSETS", "run_worker_first": ["/*",
"!/assets/*"] }`. Without `run_worker_first`, a call posted to a path with a file (a root remote's,
to `/`) gets 405 from the assets. Leave `not_found_handling` unset - its single-page mode serves the
prerendered home page for client routes.

### From 0.5

| 0.5 | 0.6 |
| --- | --- |
| `import { config } from "@expressive/dev/server"` | `from "@expressive/dev"` |
| `around: (next, { env }) => db.session(next, …)` | `handle: ({ env, next }) => db.session(next, …)` |
| `fetch(request, env, ctx, next)` answering paths | `handle`, returning a `Response` |
| `fetch` returning nothing to fall through | `handle` returning nothing |
| `scheduled` (and other members) | `host`'s return value |
| `around` wrapping calls only (no `fetch`) | `handle` wraps pages and static files too |
| a throw in `fetch` reaching the host | an `HttpError`'s status, else a logged 500 |
| `Cookies.set` or `X.get()` inside `fetch` | `Set-Cookie` on `handle`'s `Response` |
| `export async function bindings()` | `config.env` in `index.dev.ts` |
| `declare module "@expressive/rpc" { interface Env }` | `declare module "@expressive/dev"` |
| `AppConfig` | `Settings` |

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
`feed/latest:add` inside `remote/`), the tab's `x-expressive-connection` id, and the arguments as a
JSON array. The reply is `{ value, frame }` - the frame carries what the call changed on the tab's
twins (below). Only the folder and those below it may import its sidecar.

Only what the client imports is callable: the server accepts calls to the stubs the browser loaded in
dev, and to those the client build generated in production - a helper module in `remote/` is never
an endpoint. Remote calls are not a public API. The production build names each call by a hash
unique to the build, so a stale tab fails rather than calling changed code; `remote: { opaque: false }`
in `index.ts` keeps readable names, for clients that must outlive a deploy.

A sidecar may also export `Error` subclasses. Thrown on the server, one rejects the call on the
client as the same class - `instanceof` works - with its message and own fields; a numeric
`status` field in 400-599 sets the reply's status (409 below, else 500); a 3xx `status` with a
`location` field redirects a refused entry (below) and replies 500. Any other thrown error
rejects with its message in dev and a generic one in production.

```ts
export class Overflow extends Error {
  status = 409;
  constructor(public limit: number) { super(`The tally stops at ${limit}.`); }
}
```

The build refuses any other export - a sync function, a value, a class without `extends` or a
re-export - since the client could not use it; a default is the folder's twin (below). A class whose base is not an `Error`
fails its first call in dev and the built service at startup.

### Server Model

Server Model is a folder's `default` class - its seat, built at the call's location - and the
children it owns. Inside a call, `X.get()` finds the nearest seat or owned child at that location
or above; it throws outside a call. `/blog/a` and `/blog/b` hold separate seats, every visitor to a
location shares one, and a seat further down shadows one above. A seat lives while a call holds it,
then `static ttl` seconds (300 by default); `set(null)` ends it at once, with its children. A child
created lazily (`draft = set(() => new Draft())`) is found once its owner has read it - reach it
through the owner (`Tally.get().draft`).

```ts
export default class Tally extends Model {
  static ttl = 3600;
  total = 0;
}

export async function add(by: number) {
  return (Tally.get().total += by);
}
```

`Current` (from `@expressive/dev/server`) is the request in progress, readable from any server
Model or function in a call: `Current.get().url`, `.cookies`, `.request` (a Web `Request`), and `setHeader` for
that call's reply. Cookies the app uses are better declared as a `Cookies` subclass (see below). Its accessors read the
call live, so a reused instance may hold it in a field (`current = get(Current)`) but should not
copy its values into its own.

### Twins

A folder's remote entry (`remote.ts` or `remote/index.ts`) may default-export a Model class. Every
call walking through the folder seats one instance in its context - `get()` finds it there and below
- and on the client the folder's Route builds its twin and provides it below. The twin's methods
are the class's public `async` methods, each a call to that instance.

```ts
// app/counter/remote.ts
export default class Counter extends Model {
  count = 0;
  async increment() { return ++this.count; }
}
```

```tsx
// app/counter/index.tsx
import Remote from "./remote";

export class Page extends Component {
  remote = get(Remote);
  render() {
    const { remote } = this;
    return <button onClick={() => remote.increment()}>{remote.count}</button>;
  }
}
```

`static key()` narrows the folder's context, and everything below it, by what it returns - an
identity from a `Cookies` field, or a value from a seat above through `get()`. Undefined passes
the location through; throwing denies the call. Build the key from verified data only - a raw cookie
lets the client pick its context - and declare it `protected`. The seat lives for `static ttl` after
its last call; when it ends, its context and everything below go with it.

#### Entry

Entering a folder with a seat waits for the server. Its Route builds the twin and holds the page -
the current one during in-app navigation, `Loading` on a cold load - until the twin's first pull
returns. The pull walks every `key()` from the root down to the folder, and waits for each seat it
newly builds - an `async new()` included. The folder's entry hook then runs with `route.remote`
fetched. A refused pull reaches the nearest `Catch`; an exported error class carrying a 3xx `status`
and a `location` field redirects there instead, as does one thrown by the hook. Leaving the route
ends the twin; returning, or a change of the folder's own params, builds a fresh one.

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

export default class Account extends Model {
  name = "";
  admin = false;

  protected static key() {
    const { session } = AppCookies.get();
    if (!session) throw new SignIn("Sign in first.");
    return session;
  }

  protected async new() {
    const user = await db.user(AppCookies.get().session!);

    this.name = user.name;
    this.admin = user.admin;
  }
}
```

```tsx
// app/account/index.tsx
import type Account from "./remote";

export default (route: Route & { remote: Account }) => (route.remote.admin ? undefined : "/");

export class Page extends Route {
  declare remote: Account;

  render() {
    return <h1>{this.remote.name}</h1>;
  }
}
```

A `Route` below the folder reads the seat as `this.remote`; `declare remote: Account` types it.
Declare it rather than `remote = get(Account)`, which replaces the field and, on the folder's own
Route, looks past the twin that Route provides. Anything else below reaches it through `get(Account)`.

Methods a seat inherits cross too: the build follows its bases by import - source, or a package's
`.d.ts` - up to `@expressive`'s classes, and the nearest declaration's `private`/`protected` wins. A
base it cannot follow, such as `extends mixin(Model)`, fails the build.

A twin holds the seat's public values too. It attaches a microtask after construction and suspends until the
snapshot arrives. Every call's reply - a twin's method or a plain function - carries everything that
changed on any twin the tab holds since that twin last heard, so an awaited call never reads stale,
even where it changed a parent folder's twin through `get()`. Values change on the server only -
assigning a twin field throws. Changes made elsewhere - another tab, a timer on the server - arrive
on a stream the tab opens with its first twin: the server names what went stale and the twin pulls
it.

A field holding a Model its class owns - `line = new Line()`, or one declared `line?: Line` - is a
child: the twin holds a twin of it, read-only like its other values, whose public `async` methods
call through the owner (`order.line.bump()`). Assigning a new instance on the server replaces the
child twin; clearing the field leaves it `undefined`. A public `get()` field fails the build - make
it `protected` or `private`.

A value still pending on the server - a `set()` field not yet assigned, or a getter waiting on one -
is pending on the twin too: reading it suspends until the server assigns it. A value the twin already
holds stays, unless the server rebuilt the instance.

A remote module may also export Model classes. Each is a twin built per construction: every one a
Component owns as a field (`cart = new Cart()`), or `Cart.new()` anywhere, gets a server instance of
its own, alive while the client holds the twin. Build twins through those two - not a standalone
`new Cart()`. It is built under the component's nearest route, so its `get()` fields reach the seats
above it and every `key()` above it runs on each call; off any route it has no seat above it.

```ts
// app/shop/remote.ts
import { Model, get } from "@expressive/mvc";

export default class Shop extends Model {
  name = "Shop";
}

export class Cart extends Model {
  protected shop = get(Shop);
  items = 0;
  async add() { return ++this.items; }
}
```

Reload the page when a call changes what a seat's `key()` returns - a login, a logout, switching
accounts. Twins hold the context they were built in; a pooled twin's next request is refused once that
context is replaced, but values already shown, client state under the route and replies to other
calls can still carry the previous identity's data until the page reloads.

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
`config` comes from the root. Server-only API - `compose`, `Current` - is `@expressive/dev/server`;
the generated server entry imports `listen` from there. Under `target: "fetch"` it calls
`@expressive/dev/fetch`'s `compose` instead - entry plumbing, not an API to call by hand.

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
calling a remote function or a twin's method, or reading a twin's values, aborts that page's render
and leaves that page to the browser, counted in the build's summary. So a `remote/` at the root of
`app/`, shared by many screens, still lets `/privacy` and `/terms` prerender, while a dashboard that
loads its data on render does not.

- A call from `new()` counts; one from an event handler or effect never runs.
- A seat is built without a pull. Pages under it render until one reads it, and an entry hook or
  `Layout` that reads it, or calls the server, leaves every page below it to the browser.
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

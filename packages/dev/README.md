# @expressive/dev

`expressive dev` and `expressive dev build` for an Expressive app: Vite underneath, `@expressive/dom`
as the renderer, `@expressive/router` for the tree that `app/` generates, and `@expressive/inspect`
on the dev server.

## Project layout

```
app/                  file-based routes
  index.tsx           /            exports: Page, Layout, Loading, Catch, label, Router, default
  (about).tsx         /about       static leaf
  blog/index.tsx      /blog        folder = scope; its index is the "/blog" page
  blog/[slug].tsx     /blog/:slug  param leaf
  docs/[...].tsx      /docs/*      catch-all - zero segments or more; docs/index.tsx wins /docs
  blog/remote.ts      sidecar      server module for /blog and below
  blog/remote/        sidecar      or a folder of them, any depth, index optional
app.tsx | src/app.tsx single root component instead of app/ (default export)
api/                  optional HTTP routes under /api: verbs, calls, catch-alls, folder gates (api/ routes, below)
  (hello).ts          /api/hello   leaf - names as in app/
  photo/[id].ts       /api/photo/:id
  photo/store.ts      helper       bare names are support modules, as in app/
index.ts              optional server entry: export default config({ port, handle, target, host })
index.dev.ts          optional, dev only: index.ts's settings plus env(), the bindings a host would pass
index.html            optional custom shell (#root and the entry script are injected if missing)
vite.config.ts        optional, merged under the host's config
```

Bare-named files under `app/` and `api/` are support modules, not routes. `Page` may be a function,
reading its params through `Route.get().match`, or `class Page extends Route` (from
`@expressive/dev`) with `this.match`, its own fields and `render()`. That is the one intended use of `Route` - folders
express nesting. dev's `Route` owns no suspense boundary unless given a `fallback` or `Catch`, so a
page's waits show its slot's `Loading`.

Route content nests `default` → `Layout` → `Page`; each is optional, and a missing one passes its content through.

| Export | Use it for |
| --- | --- |
| `default` | Route state as a Model, a Component that also wraps, or the page itself in a leaf. |
| `Layout` | A frame around the page. |
| `Page` | A folder's index page, or a leaf whose state and view are separate. |
| `Catch` | The folder's error and not-found screen. |

A class `default` is built during the navigation hold. Its `new()` may await and throw `Redirect` or `NotFound` before anything below renders. The route provides the instance below, so `X.get()` finds it; a Component default places `Layout` and `Page` through `props.children`. It is destroyed after navigation settles away from the route, then rebuilt on re-entry or a param change. `new()` runs once per instance: a sign-out guard there does not re-run; read the session in `render()` when the page must react. Calls after the first `await` in `new()` use params from the old URL during a hold. A function default renders as a wrapper, or as a leaf page. It must return an element; wrap text in a fragment. A leaf Model default without `Page` renders nothing and warns. An index default that never reads `children` - a function's `children` prop, a Component's `this.props.children` in `render` - warns at build and on save in dev when its module has a `Page` or `Layout` or its folder has routes below, since those would never show.

A route can guard itself:

```tsx
// app/me/index.tsx
import { Redirect } from "@expressive/dev";
import { Component, get, set } from "@expressive/mvc";
import { Session } from "../session";
import * as account from "./remote";

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

In a page, throw `new NotFound()` for a missing record or `new Redirect("/login")` to navigate:

```tsx
import { NotFound, Redirect } from "@expressive/dev";

export function Page() {
  if (!record) throw new NotFound();
  if (!session) throw new Redirect("/login");
  return <article>{record.title}</article>;
}

export function Catch({ error, retry }) {
  return error instanceof NotFound ? <p>Record not found</p> : <button onClick={retry}>Try again</button>;
}
```

`Catch` replaces the folder's `Layout` while showing an error. A folder `Catch` claims every unmatched path below it ahead of a root `[...]` page. A redirect followed immediately by another shows `Catch`: an `a → b → c` chain stops at `b`.

`Loading` is the placeholder for the content slot of the `Layout` beside it: any page rendered
there that cannot show anything yet - its code, its default guard or its data still pending - shows
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

The tsconfig's `include` must list `api/`, `index.ts` and `index.dev.ts` beside `app/` - nothing
imports them, so `tsc` checks them only through `include`. Add any folder they import from too:

```json
{ "include": ["app", "api", "index.ts", "index.dev.ts", "env.d.ts"] }
```

## Start here

One small app, grown a step at a time. Each step links to its reference section below.

**1. A page.** A file in `app/` is a route. `expressive dev` serves it, and a deep link or a
refresh on `/about` loads the right page - [Project layout](#project-layout).

```tsx
// app/(about).tsx
export function Page() {
  return <h1>About</h1>;
}
```

**2. A server function.** A `remote.ts` beside a page runs on the server. The page imports it like
any module and gets a typed call - no fetch code - [Sidecars](#sidecars).

```ts
// app/tally/remote.ts
let total = 0;
export async function add(by: number) { return (total += by); }
```

```tsx
// app/tally/index.tsx
import { Component } from "@expressive/mvc";
import { add } from "./remote";

export class Page extends Component {
  total = 0;

  async bump() {
    this.total = await add(1);
  }

  render() {
    const { total, bump } = this;
    return <button onClick={() => bump()}>Total: {total}</button>;
  }
}
```

**3. HTTP routes.** A file in `api/` answers under `/api`, named as in `app/`: `(hello).ts` is a
leaf, `[id].ts` a param, and a bare name like `store.ts` is a helper. Export a verb; a returned
object is JSON. Params are read from `Current` - [api/ routes](#api-routes).

```ts
// api/(hello).ts - GET /api/hello
export const GET = () => ({ hello: "world" });

// api/photo/[id].ts - GET /api/photo/7
import { Current } from "@expressive/dev/server";
export const GET = () => ({ photo: Current.get().params.id });
```

**4. Gates.** A folder's `index.ts` may default-export a gate. It runs before every route in the
folder - throw to refuse.

```ts
// api/admin/index.ts
import { Current } from "@expressive/dev/server";
import { Forbidden } from "@expressive/dev/server";

export default () => {
  if (Current.get().cookies.admin !== "root") throw new Forbidden("Admins only.");
};
```

Pages get the same idea through `remote.ts`: its default export gates every call in the folder, and
the pages too - the browser asks the server before showing one ([Server Model](#server-model),
[Gate check](#gate-check)). A guest here lands on `/login`:

```ts
// app/account/remote.ts
import { Current } from "@expressive/dev/server";
import { Redirect } from "@expressive/dev/server";

export default () => {
  if (!Current.get().cookies.session) throw new Redirect("/login");
};
```

**5. Middleware.** `index.ts` configures the server. `handle` runs around every request - calls,
`api/` routes, pages and files - [handle](#handle).

```ts
// index.ts
import { config } from "@expressive/dev";

export default config({
  handle: ({ request, next }) => {
    console.log(request.method, request.url);
    return next();
  },
});
```

To run the app inside something - a database session, a transaction - return `next()` from within
it: `handle: ({ next }) => db.session(() => next())`.

**6. Deploying to Workers.** `target: "fetch"` builds a fetch handler instead of a Node server. Pages
and files come from the `ASSETS` binding in `wrangler.jsonc`. Declare bindings on `Env` to type
`env` - [Deploying to a fetch host](#deploying-to-a-fetch-host).

```ts
// index.ts
import { config } from "@expressive/dev";
import { db } from "./db";
import { d1 } from "./d1";

declare module "@expressive/dev" { interface Env { DB: D1Database } }

export default config({
  target: "fetch",
  handle: ({ env, next }) => db.session(() => next(), d1(env.DB)),
});
```

In dev there is no Worker, so `index.dev.ts` supplies the bindings from wrangler's local platform.
`expressive dev` reads it in place of `index.ts`; the build never does - [env and index.dev.ts](#env-and-indexdevts).

```ts
// index.dev.ts
import type { Env } from "@expressive/dev";
import { getPlatformProxy } from "wrangler";
import settings from "./index";

settings.env = async () => (await getPlatformProxy<Env>()).env;

export default settings;
```

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
  handle: ({ next }) => db.session(() => next()),
});
```

- Returning nothing passes through `next()`'s reply if it was called, else calls it. Anything else
  returned throws. `next()` runs once, and only until `handle` returns.
- Returning nothing suits a `handle` that doesn't wrap the app - a check, a log line. A `handle`
  that wraps it (a session, a transaction) must `return next()` inside the wrapper and return the
  wrapper's result. Otherwise the app runs after the wrapper has closed, and fails with the
  wrapper's own error (dev warns once when a 5xx follows a `handle` that returned nothing):

  ```ts
  // right - the app runs inside the session, which stays open until the reply
  handle: ({ next }) => db.session(() => next()),

  // wrong - next() is never called inside the session, and nothing is returned, so the app
  // runs after handle returned, once the session has closed
  handle: async ({ next }) => {
    await db.session(async () => audit());
  },
  ```
- `next(request)` forwards a rewritten request. Anything other than a `Request` throws, so a wrapper
  that calls back with its own value (`db.transaction(next)`) fails loudly - wrap it: `() => next()`.
  To read the body and still pass it on, read `request.clone()`.
- `next()` resolves a `Response` with mutable headers (a 101 upgrade as is); a throw below resolves
  its error reply rather than rejecting. A reply `handle` discards has its body cancelled.
- `handle` runs outside the request's scope: `Current`, `Cookies` and `get(Model)` throw there, and
  work inside `next()` - `db.session(() => next())` encloses all of it. Cookies go out on the `Response` it
  returns; work after the reply goes through `ctx.waitUntil`.
- A thrown `HttpError` answers its status - on a call as the call's error, else JSON `{ message }`
  (`Redirect` sets `Location`). Anything else is logged and answered with a 500 whose message shows
  in dev only.
- Below `handle`: a remote call, else an `api/` route under `/api` (below), else the page or file - on Node, the file or `<path>/index.html` from
  `dist/client`; on the `fetch` target, from `assets` (`env.ASSETS` by default); in dev, the file
  or `<path>/index.html` from `public/`. Else the shell (`200.html`, else `index.html`) for a GET or HEAD outside `build.assetsDir`:
  with 200 on a path a page route matches, with 404 for a navigation (`accept` has `text/html`) no
  route matches, so the nearest `Catch` handles `NotFound`. Anything else is a bare 404, so a stale chunk
  never comes back as HTML; a built app answers other methods than GET and HEAD with 404 too. A
  single-file app (`app.tsx`) gets the shell with 200 for every navigation. The page routes are
  the `app/` files exporting `Page` or a leaf `default` - a deep link into a route the scan can't see (a custom root
  `Router`, a `<Route>` in a `Layout`) gets the shell with 404; a `[...]` page claims those paths.
- Remote calls and gate checks ignore a non-root Vite `base` for now - they post to the app's
  paths from `/`.
- In dev, Vite's own requests skip it: paths outside `base`, `/@vite/*`, `/@id/*`, `/@fs/*`,
  `/node_modules/*`, `/.expressive/*` other than calls, `/__inspect`, `/__open-in-editor`,
  `server.proxy`'s prefixes, the bare `?import`, `?url` and `?raw` flags, and source files under
  the root outside `public/`. Calls and `/api` paths never skip it. A request it passes that is neither a file nor a navigation goes on to
  Vite's middlewares, with the headers `handle` added and the request it forwarded.
- A navigation never reaches a later middleware - dev answers it with the shell first. A Vite plugin
  in `vite.config.ts` that serves pages from its own `configureServer` middleware needs
  `enforce: "pre"` to run ahead of dev's.

`env` is the request's bindings - see env and index.dev.ts, below.

`compose(settings)` from `@expressive/dev/server` builds the app without a server, for tests of
`handle` - pages come from a stubbed `assets`:

```ts
import { compose } from "@expressive/dev/server";
import settings from "../index.ts";

const app = compose(settings);
const page = await app(new Request("http://x/invite/abc"), { assets: { fetch: async () => new Response(shell) } });
```

It composes no remotes and no `api/` routes. Test a route's logic by moving it into a function of
plain arguments - a helper beside the route - which the route calls with what it reads from `Current`:

```ts
// api/photo/store.ts
export const photo = (id: string) => db.photos.find(id);

// api/photo/[id].ts
import { photo } from "./store";
export const GET = () => photo(Current.get().params.id);

// api/photo/store.test.ts
expect(await photo("7")).toMatchObject({ id: "7" });
```

### api/ routes

A root `api/` folder beside `app/` holds HTTP routes, served under `/api`. A module's location is
its path, named as in `app/`:

```
api/index.ts          /api
api/(logout).ts       /api/logout
api/photo/[id].ts     /api/photo/:id
api/photo/store.ts    a helper - bare names are not routes
api/auth/[...].ts     /api/auth/* - one segment or more; /api/auth itself needs api/auth/index.ts
```

A bare-named `.ts`, `.tsx`, `.js` or `.jsx` file is a helper: it may export anything, and routes
import it. `*.test.*`, `*.spec.*` and `.d.ts` files are skipped. Routes take no parameters - they
read the request from `Current`:

```ts
// api/photo/[id].ts
import { Current } from "@expressive/dev/server";
import { photo } from "./store";

export const GET = () => photo(Current.get().params.id);

// api/(hook).ts
export async function POST() {
  const { json, send } = Current.get();
  const event = await json();

  await send(200);
  await record(event); // after-work: runs once the reply has left
}
```

- `GET`, `POST`, `PUT`, `PATCH`, `DELETE` and `OPTIONS` answer that method on the module's own path.
  A returned value is the reply: a `Response` as is, a plain object or array as JSON, a string as
  text, nothing as 204. HEAD runs `GET` and drops the body. Another method gets 405 with `Allow`.
  Nothing answers OPTIONS for you - CORS and preflight go in `handle` or a folder gate.
- HEAD runs `GET` in full, side effects included, and browsers and crawlers prefetch GETs - so
  keep anything that changes state off `GET`. A logout is `POST` in `api/(logout).ts`, not `GET`.
- A route or gate that throws anything but an `HttpError` answers a logged 500 - its message shows
  in dev only, as with `handle`.
- A `default` export answers every method on its path - a catch-all, and the place to mount a
  fetch handler. Routes take no arguments, so the default is an arrow that returns the handler,
  which is then called with `(request, env, ctx)`:

  ```ts
  // server/legacy.ts
  export const legacy = new Hono().basePath("/api/legacy").get("/users/:id", c => c.json({ id: c.req.param("id") }));

  // api/legacy/[...].ts - /api/legacy/*
  export default () => legacy.fetch;

  // api/legacy/index.ts - /api/legacy itself; a verb may return a handler too
  export const GET = () => legacy.fetch;
  ```

  The path is not rewritten: the handler sees `/api/legacy/users/1`, so the mounted app needs its
  base path. A `fetch` that needs `this` goes bound: `() => app.fetch.bind(app)`.
- In a folder's `index.ts`, `default` is instead the folder's gate. It runs before every route in the
  folder and below, outermost first - for paths no route matches too, so a refused caller gets the
  same answer either way. Finish to pass; throw to refuse (an `HttpError` answers its status as JSON
  `{ message }`, anything else a logged 500); return a `Response` or a fetch handler to answer;
  `Current.get().next()` runs everything below and resolves its reply, to wrap it. Models the gate
  activates are found by `X.get()` below it until the request ends, and a failing async `new()`
  refuses:

  ```ts
  // api/account/index.ts
  export default () => {
    Session.new(); // its async new() reads the cookie and throws Unauthorized to refuse
  };

  // api/account/(me).ts
  export const GET = () => Session.get().user;
  ```

  A gate sees its own folder's params; a route sees the full match's.
- A path no route serves, or a folder `index.ts` with only a gate, is a JSON 404 - never the shell.
  In dev, when a helper sits where the path would be (`api/webhook.ts` for `/api/webhook`), the 404
  says so: `api/webhook.ts is a helper - rename it api/(webhook).ts to serve /api/webhook.`
- Matching is exact and case-sensitive, on decoded segments - `/api/caf%C3%A9` reaches `api/(café).ts`.
  A fixed name beats a `[param]`, which beats `[...]`, and a segment never backtracks: once
  `api/admin/` matches `admin`, `/api/admin/users` is a 404 if `admin/` lacks `users`, even beside
  `api/[org]/(users).ts`. A malformed `%` escape is a 400. An empty segment (`//`, a trailing `/`)
  never matches, except inside the rest `[...]` takes - its first segment must be non-empty.
- Params arrive decoded, slashes included (`%2F` is `/`) - never join one onto a file path.

#### Calls

Any other exported async function in a route is a call. The app imports it, gets a typed stub, and
the function runs on the server:

```ts
// api/(account).ts
export const GET = () => Session.get().user; // REST: GET /api/account

export class Taken extends Error {
  status = 409;
}

export async function rename(name: string) { // call
  if (await db.user.exists(name)) throw new Taken(`${name} is taken.`);
  return db.user.rename(name);
}

// app/me/index.tsx
import { rename, Taken } from "../../api/(account)";
```

- A call is a `POST` to its module's path - `api/(account).ts` posts to `/api/account`,
  `api/admin/index.ts` to `/api/admin` - with the `x-expressive-call` header naming it and a JSON
  array of arguments. The reply is `{ value }`. A `POST` without the header goes to the module's
  verbs, so a call and `POST` share a path.
- Calls are always `POST`. Export `GET` to serve a GET - a call with no parameters can still mutate.
- The folder gates run before a call as before a verb: a refusal rejects the call with the gate's
  error, Models a gate activates are found by `X.get()` in the call, and `next` wraps it.
- An exported `Error` subclass crosses with the calls: thrown on the server, it rejects on the
  client as the same class, its fields kept - one a gate throws too, whichever route exports it.
  Other errors answer a 500, as with `handle`.
- Only calls the client build imports are callable; an unimported export is no endpoint. Their ids
  are a per-build hash unless `remote: { opaque: false }`. In dev, the calls of every route module
  the browser loaded are callable.
- A call reads the request from `Current` - cookies, headers, `env`.
- Calls sit on static paths: a module under `[param]` or `[...]` with a call fails the build -
  take the id as an argument. `api/index.ts`'s calls are reserved, like its other exports.
- The client may import a route's calls, `Error` subclasses and types - not its verbs or its
  `default`, and nothing from a helper.

The dev server and the build fail on:

- a route with no verbs, no `default` and no calls (a folder `index.ts` with only a gate is fine), a
  `default` beside verbs outside an `index.ts`, or a class as a folder's `default` - a function that
  activates the Model covers it;
- any other runtime export from a route - a function that isn't async, a class that isn't an
  `Error`, a value or a re-export (type exports are fine) - `api/index.ts`'s are reserved. A
  route re-exporting with `export *` fails the build: list the verbs by name, `export { GET } from`;
- a helper exporting a verb-named handler (`export function GET`, `export const POST = () => …`) -
  it was meant as a route, so name the file `(name).ts`. The build fails; dev logs it on save.
  Helpers shouldn't export verb-named handlers; a verb-named value that isn't a function, or a
  re-export, is not flagged;
- a `().ts` with no name, `(name)` folders, a `[...]` folder, a named rest (`[...slug]` - use
  `[...]` or `[slug]`), a name starting with `:` or `*`, two `[param]`s in one folder, and two
  modules on one path (`api/(dev).ts` beside `api/dev/index.ts`);
- `app/api/`, `app/(api)/`, `app/(api).tsx` or `public/api/` beside `api/`, in any case - `/api`
  belongs to the folder. Without `api/`, the app may own `/api` itself;
- a call under a `[param]` or `[...]`;
- a client module importing a verb or a `default` from a route, or anything from a helper, through
  an alias too.

In dev, routes load on the module runner per request, so an edit to a route or a helper it imports
lands on the next one; a file added, removed or renamed under `api/` is picked up as well. A save
under `api/` logs these errors, and a request to a broken route answers a 500 naming the file. A
helper that doesn't parse fails only the routes importing it. `api/` routes are never prerendered.

### env and index.dev.ts

`handle`'s `env` and `Current.get().env` hold the request's bindings:

- On the `fetch` target: the host's `env` object, as is.
- On Node and in dev: a read-only view over `process.env`, the `.env` files and (in dev) what
  `index.dev.ts`'s `env()` returns.

Live objects from `env()`, such as a local database standing in for a host binding, always come
through. Strings from the shell or `.env` override `env()`'s strings - a production URL in
wrangler's `vars`, say - and `process.env` wins over `.env`. The keys `expressive env` writes to `env.d.ts` type `env` too.

`expressive dev` reads `index.dev.ts` in place of `index.ts` when it exists. It imports `./index`
(no extension, so the app's tsconfig needs no extra flag), sets `settings.env` and default-exports
the settings. The build never reads it, so nothing it imports reaches a bundle. `env` set in
`index.ts`, a 0.5 `bindings` export, and an `index.dev.ts` without a default export fail the dev
server and the build.

Dev calls `env()` once per server, and again only after it throws - a change to `env()` needs a
restart. A `null` or `undefined` result binds nothing.

`{ ...env }` and `Object.keys(env)` see only `env()`'s keys on Node and in dev, never `process.env`
or `.env` - read keys by name.

On Node, a database the app opens itself needs none of this: import it from a module. For a
Workers binding, see the example under Deploying to a fetch host.

### Deploying to a fetch host

`config({ target: "fetch" })` builds `dist/server/index.js` as a module with every dependency
bundled, for a host that calls its default export's `fetch(request, env, ctx)` rather than running
a server.

- `host(app)` returns that default export, for platform handlers dev does not model; one without
  `fetch` gets `{ fetch: (request, env, ctx) => app(request, { env, ctx }) }`. Dev never calls it, and
  on the Node target it fails the build.
- `env` is the host's second `fetch` argument, as `handle` and `Current.get().env` read it - no
  `process.env` or `.env` layer.
- `index.ts`'s named exports are re-exported (Durable Object classes) - listed ones only, not
  `export *`; export types with `export type`.
- `index.ts` also loads in Node, at build and in dev - import a module only the host resolves lazily,
  and list it in `build.rollupOptions.external` of `vite.config.ts`. Resolve conditions go there too.
- The bundle imports `node:async_hooks` and `node:crypto` (rpc's request scope).

Cloudflare Workers with static assets, for example - a cron and a session per request on a D1
binding:

```ts
// index.ts
import { config, type Env } from "@expressive/dev";
import { db } from "./db";   // SQLiteConnection.new(types) - no source
import { d1 } from "./d1";   // the app's adapter from a D1 binding to sql's Engine
import { sweep } from "./jobs";

declare module "@expressive/dev" { interface Env { DB: D1Database } }

export default config({
  target: "fetch",
  handle: ({ env, next }) => db.session(() => next(), d1(env.DB)),
  host: () => ({
    scheduled: (event: ScheduledController, bound: Env) => db.session(() => sweep(), d1(bound.DB)),
  }),
});
```

Pages and files come from the `ASSETS` binding, the shell included - the binding must be named
`ASSETS`. Under another name, pass it yourself:
`host: app => ({ fetch: (r, env, ctx) => app(r, { env, ctx, assets: env.STATIC }) })`. `scheduled`
runs outside any request, so it reads the platform's `env` argument and opens its own session.

In dev, `index.dev.ts` gives `handle` the same bindings from wrangler's local platform, read from
`wrangler.jsonc`:

```ts
// index.dev.ts - read by `expressive dev` instead of index.ts; never built
import type { Env } from "@expressive/dev";
import { getPlatformProxy } from "wrangler";
import settings from "./index";

settings.env = async () => (await getPlatformProxy<Env>()).env;

export default settings;
```

Strings set in the shell or `.env` win over `vars` from `wrangler.jsonc`, so a line in `.env`
overrides a production URL there for dev. `wrangler d1 migrations apply DB --local` creates the
local database's tables - dev runs no migrations.

`wrangler.jsonc` sets `"main": "dist/server/index.js"`, `"compatibility_flags": ["nodejs_compat"]`
and `"assets": { "directory": "dist/client", "binding": "ASSETS", "run_worker_first": ["/*",
"!/assets/*"] }`. Without `run_worker_first`, a call posted to a path with a file (a root remote's,
to `/`) gets 405 from the assets. Leave `not_found_handling` unset - its single-page mode serves the
prerendered home page for client routes.

### From 0.5

| 0.5 | 0.6 |
| --- | --- |
| `import { config } from "@expressive/dev/server"` | `from "@expressive/dev"` |
| `around: (next, { env }) => db.session(next, …)` | `handle: ({ env, next }) => db.session(() => next(), …)` |
| `fetch(request, env, ctx, next)` answering paths | an `api/` route, or `handle` returning a `Response` |
| `fetch` returning nothing to fall through | `handle` returning nothing |
| `scheduled` (and other members) | `host`'s return value |
| `around` wrapping calls only (no `fetch`) | `handle` wraps pages and static files too |
| a throw in `fetch` reaching the host | an `HttpError`'s status, else a logged 500 |
| `Cookies.set` or `X.get()` inside `fetch` | `Set-Cookie` on `handle`'s `Response` |
| `export async function bindings()` | `settings.env = () => ({ ... })` in `index.dev.ts` |
| `bindings` on the fetch target only, in dev | `index.dev.ts` on either target |
| Node's `Current.get().env` as `{}` | `process.env` over `.env` |
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
`feed/latest:add` inside `remote/`), and the arguments as a JSON array. The reply is `{ value }`.
Only the folder and those below it may import its sidecar.

Only what the client imports is callable: the server accepts calls to the stubs the browser loaded in
dev, and to those the client build generated in production - a helper module in `remote/` is never
an endpoint. Remote calls are not a public API. The production build names each call by a hash
unique to the build, so a stale tab fails rather than calling changed code; `remote: { opaque: false }`
in `index.ts` keeps readable names, for clients that must outlive a deploy.

A sidecar may also export `Error` subclasses. Thrown on the server, one rejects the call on the
client as the same class - `instanceof` works - with its message and own fields; a numeric
`status` field in 400-599 sets the reply's status (409 below, else 500); a thrown `Redirect` with a `location` navigates during render. Any other thrown error
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

export async function profile() {
  return Account.get().user;
}
```

A refused call rejects with the gate's error.

### Gate check

A folder's gate also guards its pages: before the browser shows a page under a gated folder, it
asks the server to run the gates, and shows the page only if they pass.

```ts
// app/account/remote.ts
import { Redirect } from "@expressive/dev/server";
import { Cookies } from "@expressive/dev/server";

class AppCookies extends Cookies {
  session?: string = undefined;
}

export default () => {
  if (!AppCookies.get().session) throw new Redirect("/login");
};
```

`@expressive/dev` and `@expressive/dev/server` export rpc's `Redirect` error. The client Route also catches the router's `Redirect`.

A gate reads its own folder's params from `Current` - a gate above sees only those of its folder:

```ts
// app/team/[id]/remote.ts
import { Forbidden } from "@expressive/dev/server";
import { Current } from "@expressive/dev/server";

export default async () => {
  const { id } = Current.get().params;
  if (!(await isMember(id))) throw new Forbidden("Not on this team.");
};
```

- The check is one request to the deepest gated folder on the path, answered `{}` once its gates
  pass. A pass covers that folder and those above it until a param changes; moving inside it, or
  leaving gated folders, sends nothing.
- A refusal reaches the nearest `Catch`, whose `retry` checks again.
- An error with a 3xx `status` and a `location`, or a 3xx `Response` the gate returns, redirects.
  A path some page route matches goes through the router; any other path (a server route such as
  `/api/auth/start`) and another `http:` or `https:` origin load through `location.assign`. A
  redirect into the refusing folder, a second redirect in a row, or another scheme reaches `Catch`.
- A network failure, or a reply that isn't rpc's, lets the page in without remembering a pass - the
  page's own calls still meet the gates.
- A newer navigation drops an in-flight check's verdict; its cookies still land.
- The folder's default class is built after the pass; its `new()` can guard before render.
- Not security: every call still runs its gates. Gates run for checks and calls alike, possibly
  concurrently, so they must be idempotent; rate limits and logs count checks too.
- Gated folders are not prerendered, and a root gate (`app/remote.ts`) gates every page.
- In dev, editing a remote entry with a gate clears the passes the browser remembered. Editing a
  helper the gate imports does not - navigate after a reload to check again.

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

`@expressive/dev/vite` exports the `expressive()` plugin for a hand-written Vite config; add
`@expressive/dom/vite` beside it for hot reload. The CLI adds both and `@expressive/inspect/vite`.
It also exports `runBuild`, which the CLI's build calls.
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
`import.meta.glob` or an absolute-URL `fetch`. A listed path no route matches warns and is skipped.

A page that needs the server while it renders stays client-rendered, wherever its `remote.ts` or
`remote/` sits, and the build never runs server code. In the build, remote stubs stop at the server:
calling a remote function aborts that page's render
and leaves that page to the browser, counted in the build's summary. So a `remote/` at the root of
`app/`, shared by many screens, still lets `/privacy` and `/terms` prerender, while a dashboard that
loads its data on render does not.

- A call from `new()` counts; one from an event handler or effect never runs.
- A default class or `Layout` that calls the server leaves every page below it to the browser.
- A `paths()` that calls the server lists nothing.

A page that throws `Redirect` or `NotFound` stays client-rendered and is counted once in the build summary. Rendering nothing, another throw or taking over 30 seconds warns per page.
An async `new()` on a default class settles before render; a rejection fails that page. A class built during render may reject after its page renders and warn.

A default class runs `new()` before render; other classes run it during render. Effects never run at build, so DOM listeners and browser-only reads
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

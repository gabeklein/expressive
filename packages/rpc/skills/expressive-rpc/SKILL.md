---
name: expressive-rpc
description: Typed server calls for Vite apps (@expressive/rpc) - modules in api/ run on the server, the client imports them as stubs. Use when adding or debugging server calls - module rules, groups and test, values, http errors, gates and Current, client configure, server entry, your own server (Bun.serve, Node), Worker/Node/Bun deploy.
---

# @expressive/rpc

Typed server calls for any Vite client build. Modules in one folder (`api/` by default) run on the server; the client imports them as usual and gets stubs that POST per call. Types come from the source - no schema, no codegen step.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import rpc from "@expressive/rpc/vite";

export default defineConfig({ plugins: [rpc()] });   // rpc({ dir: "api", base: "/api" })
```

```ts
// api/todos.ts
import { HttpError, NotFound } from "@expressive/rpc";

export class ProOnly extends HttpError { status = 402; }

export async function done(id: string): Promise<Todo> {
  const todo = todos.find(todo => todo.id === id);
  if (!todo) throw new NotFound(`No todo ${id}.`);

  todo.done = true;
  return todo;
}
```

```ts
// src/main.ts
import { done, ProOnly } from "../api/todos";

try { await done(id) } catch (error) { if (error instanceof ProOnly) upsell() }
```

## Module rules

A server module under `dir` may export:

- `async` functions - the calls.
- `Error` subclasses - rebuilt on the client when thrown, so `instanceof` holds; message and own fields cross.
- [Groups](#groups) - objects of calls and Error classes imported from elsewhere in `dir` - and re-exports of them.
- In an `index.ts` only, a default `Model` subclass or function - the folder's gate.

Anything else fails the build: a sync function, a value, `export *`, a non-Error class, a default outside an index. Twin-shaped exports (Model classes) are refused - stateful twins are `@expressive/dev`'s. `with` and `then` are the client's - no call, module or folder takes them.

Only calls the client build imports are served. Helpers belong outside `dir` (`server/`, `shared/`), or in a module `test` leaves plain; a type a call's signature names must be importable by the client.

`dir` is relative to Vite's root and may sit outside it: `rpc({ dir: "../api/src" })` serves calls from a sibling workspace package, imported from the client by relative path. Path aliases in that package's own tsconfig resolve with Vite's `resolve: { tsconfigPaths: true }`.

### Selecting server modules

Every script under `dir` is a server module unless `test` - a RegExp or function on the path from `dir` - picks fewer:

```ts
rpc({ dir: "../api/src", test: /(^|\/)index\.ts$/ })   // indexes only
rpc({ dir: "app", test: /(^|\/)remote\.ts$/ })        // remote.ts beside client code
```

- A module `test` leaves out is plain: its exports follow no rules, and a client import of it bundles it as it is - server code and all. Client code reaches calls through server modules only.
- A plain module a server module groups or re-exports from is stubbed for those leaves alone. Its other exports stay on the server unchecked, save Error classes, which still cross.
- A folder's gate is the default of its index only when `test` selects the index. A narrow `test` must keep the indexes whose gates guard the calls below them.

## Groups

```ts
// api/index.ts
import { Session } from "../lib/session";
import { search as searchClaims, create, Duplicate } from "./claim/search";
import { search as searchAttorneys } from "./attorney/search";

export type * as types from "./claim/search";        // types ride beside it

export default () => { Session.new(); };           // the gate

export async function hello() { return "hi"; }      // its own calls, as before

export const claim = { search: searchClaims, create, errors: { Duplicate } };
export const attorney = { search: searchAttorneys };
export { cleanup } from "./claim/cleanup";           // a single leaf
```

```ts
// src/main.ts
import { claim, type types } from "../api";

const found: types.Result[] = await claim.search(query);
```

- A leaf is an async function or Error class imported by name from a module under `dir`. An exported import or a re-export (`export { x } from`) is a leaf too.
- Each leaf is followed through re-exports to the module that defines it. That module's path, id and gates apply, exactly as if the client imported it directly. A group only groups.
- Keys are written out: no spread, computed key or method. Nesting has no limit, and a nested object may be a local `const`. A leaf must be an imported name. It can't be a default export, a namespace member, a function declared in the grouping module, or a module outside `dir`.

## Addressing

A call's address is its place in the tree: folders, then the module - an index is its folder. `api/todos.ts#list` → `POST /todos` with `x-expressive-call: list`; `api/admin/users.ts#ban` → `POST /admin/users`, `ban`; `api/index.ts#hello` → `POST /`, `hello`. Folders are static names only (`[param]` folders throw). A module and a folder of one name (`todos.ts` beside `todos/`), or a call named as a sibling path, fail the build.

Addresses are readable and stable across deploys. `opaque: true` seals call names in a build - paths stay readable - so a client from an older deploy fails instead of calling changed code.

`rpc({ base: "/api" })` serves the tree under a path - `api/todos.ts` → `POST /api/todos`. Stubs send there and `handle` answers only beneath it, given the full request - for a host that routes a prefix to the server (Firebase Hosting rewrites, a shared origin).

## Values

Arguments and results cross as JSON plus what JSON loses: `Date` (an invalid one too), `BigInt`, `NaN` and `±Infinity`, `Map`, `Set`, `Uint8Array` and `ArrayBuffer` (arriving as `Uint8Array`), and `undefined` in an array - so `f(a, undefined)` keeps its default. Each goes as a one-key tagged object (`{ "$date": "2026-11-08T12:00:00.000Z" }`), so the body stays readable JSON; a plain object whose only key is a tag is escaped, so data never reads as one. The rest is `JSON.stringify`'s: `toJSON` first, `undefined` and function properties dropped, class instances as their own enumerable fields, a circular structure refused. A thrown error's own fields ride the same codec.

## Errors

`HttpError` and its subclasses map to statuses: `BadRequest` 400, `Unauthorized` 401, `PaymentRequired` 402, `Forbidden` 403, `NotFound` 404, `MethodNotAllowed` 405, `Conflict` 409, `Gone` 410, `PayloadTooLarge` 413, `UnprocessableEntity` 422, `TooManyRequests` 429, `InternalError` 500, `NotImplemented` 501, `ServiceUnavailable` 503. A status outside 400-599 replies 500 with the error's fields intact - `Redirect(location, status = 302)` arrives as a `Redirect` carrying both, for the client to act on. Extend one, or set `status` on your own, to add a kind.

An exported Error class crosses by the name it is exported under - `"error": "Duplicate"` on the wire, and the rebuilt error's `name`. Names are app-wide: two classes exported under one name fail the build - rename at the export (`export { Taken as ClaimTaken }`); one class reached twice is fine. Keep error classes in a module both sides import (`lib/errors.ts`) and pass them to the client's `errors` to rebuild them as themselves. Any other thrown error replies 500 - its message in dev, with a warning naming its class, a generic one in build.

## Gates and Current

An index's default Model gates every call in its folder and below. Its `static key()` runs per call, root first: throw to refuse, return an identity to give the folder's context one instance per value, `undefined` to pass through.

```ts
// api/index.ts
import { Model } from "@expressive/mvc";
import { Current, Unauthorized } from "@expressive/rpc";

export default class Session extends Model {
  static key() {
    const token = Current.get().request.headers.get("authorization");
    if (!token) throw new Unauthorized("Sign in first.");
    return token;
  }
}
```

Inside a call, `Session.get()` finds that instance; `Current.get()` is the request - `.request` (a Web `Request`), `.url`, `.cookies` - read-only, server-only. A gate runs per request: its instance ends with the last call holding it. `static ttl = 60` keeps it per key that many seconds after - an optimization, so derive its state from the request, never from an earlier call - and `Session.get().set(null)` ends a cached one at once (say, in `logout()`).

### Function gates

An index's default may instead be a function, run before each call in its folder and below, root first. It refuses by throwing, or by activating a Model whose `new()` fails. Every Model it activates is this call's own: in reach of `.get()` in the call and in inner gates, waited on until ready, and destroyed when the call ends.

```ts
// api/index.ts
import { Session } from "../lib/session";   // a Model - non-Error classes cannot be exported from api/

export default () => {
  Session.new();   // its async new() verifies the token, throwing Unauthorized to refuse
};
```

- A failed `new()` refuses with its own error and status, and is not reported elsewhere.
- A Model counts when it activates during the gate or while one it activated settles, after an `await` too - `X.new()`, or `new X()` then `.set()`.
- Nothing is cached across calls - keep a costly check (verifying a token) behind a long-lived service, built at module scope: one first built inside a gate is the call's, and destroyed with it.
- A class gate below a function gate is per call too - its `key()` and `ttl` cache nothing.
- The gate returns nothing - a returned Model is not handed on.
- An index declares its gate itself: share one as `export default () => guard()`, not by exporting the import.

### Cookies

Declare the cookies the app uses as fields of a `Cookies` subclass - one field per cookie, its initial value the default when the request has none - and read and write them as a Model:

```ts
// lib/cookies.ts - a non-Error class cannot be exported from api/
import { Cookies } from "@expressive/rpc";

export class AppCookies extends Cookies {
  static options = { session: { maxAge: 60 * 60 * 24 * 30 } };

  session?: string = undefined;
  theme = "light";
}
```

```ts
// api/auth.ts
import { Unauthorized } from "@expressive/rpc";
import { AppCookies } from "../lib/cookies";

export async function login(user: string, password: string) {
  const session = await sessions.open(user, password);

  if (!session) throw new Unauthorized("Wrong password.");

  AppCookies.set({ session: session.id });
}

export async function logout() {
  AppCookies.set({ session: undefined });
}
```

- `AppCookies.get()` is this request's instance - one per request and class, built from its `cookie` header. A field the request lacks keeps its default. Reads see this call's writes.
- `AppCookies.set({ ... })` is sugar for `AppCookies.get().set({ ... })`. When the call replies, each field that changed goes out as `Set-Cookie`, and one set to `undefined` is removed with the path and domain it was set with. It goes out on a failure too, and a gate's `key()` can use it.
- `static options` holds per-cookie options by field: `maxAge` (seconds), `expires`, `path`, `domain`, `secure`, `httpOnly`, `sameSite`, `partitioned`. Unset ones are `HttpOnly`, `SameSite=Lax` and `Path=/`, plus `Secure` over https. Values are strings, URI-encoded on the wire.
- Reach it through `AppCookies.get()` within a call, never `get(AppCookies)` as a field - a Model reused across calls would hold one request's cookies, so it is not in context and that lookup fails.

Set-Cookie reaches a browser's cookie jar on its own; a cross-origin client needs `credentials: "include"` in its `transport`.

`Current` is the lower level, for adapters and libraries: `.request`, `.url`, `.cookies` (every cookie as sent, undeclared ones included) and `setHeader(name, value)` for any other reply header - the reply's own (`content-type` and the like) win; read one on the client through `configure({ reply })`.

## Client

Stubs call through a shared client, `fetch` by default:

```ts
import { configure } from "@expressive/rpc";

configure({
  base: "https://api.example.com",          // cross-origin or no `location` (Node, native)
  headers: () => ({ authorization: `Bearer ${token}` }),
  transport: request => fetch(request),     // replaces fetch - service bindings, retries
  reply: async response => {},              // sees every response
});
```

`client(options)` builds a separate one. Without a `location`, a relative `base` throws - pass an absolute one. `configure({ base })` goes in front of the plugin's `base` - an origin, not the path again. `errors: { Duplicate }` rebuilds a thrown error as the class given for its name, not a stand-in.

Every stub is a member of the client's `api` tree - `api.admin.users.ban` is `ban` from `api/admin/users.ts`, the same function each access. Any node or call takes `.with({ signal, timeout })` for the calls under it; nested, the inner extend the outer:

```ts
import { list } from "../api/todos";

await list.with({ signal: controller.signal, timeout: 10_000 })();
```

An abort rejects with the signal's reason, a timeout with a `TimeoutError`.

## Server entry

To put routes beside the calls - cookies, uploads, downloads, streams, a `scheduled` handler or Durable Object classes - write the server yourself and name it:

```ts
// vite.config.ts
export default defineConfig({ plugins: [rpc({ entry: "server.ts" })] });
```

```ts
// server.ts
import { handle } from "@expressive/rpc/calls";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/health") return Response.json({ ok: true });

    return (await handle(request)) ?? env.ASSETS.fetch(request);
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {},
};

export { Room } from "./room";   // a Durable Object, say
```

- `handle(request)` answers a call and gives anything else `undefined`. Pass the request as received - under `rpc({ base })` it matches the prefix itself.
- The entry and the calls share one copy of every module, in dev and in the build.
- The entry's `fetch` runs in the request's scope, as a call does: `Current.get()` is the request and a `Cookies` subclass reads and sets cookies in any route, what it sets joining the route's response. A folder's gate is the calls' - a route checks its own access.
- `vite build` bundles the entry as `dist/server/index.js`, its other exports included.
- In dev the entry's `fetch` runs on every request before Vite, with `ctx.waitUntil` logging a rejection. `env` is `rpc({ env })`'s result (say, wrangler's `getPlatformProxy().env`) plus an `ASSETS` that hands the request back to Vite.
- In Hono, `handle` is middleware - `undefined` falls through to `next()`. Hono's `mount()` would strip the prefix and wants a handler that always returns a `Response`; neither fits, so skip it:

  ```ts
  const app = new Hono<{ Bindings: Env }>();

  app.use(async (c, next) => (await handle(c.req.raw)) ?? next());
  app.get("/api/health", c => c.json({ ok: true }));
  app.notFound(c => c.env.ASSETS.fetch(c.req.raw));

  export default app;
  ```
- `@expressive/rpc/calls` is the server's: a client import fails the build, and a call to `handle` outside a server the plugin builds or runs throws. One rpc dev server per process serves it.

## Your own server

Where the app already runs a server - Bun, Node, a Worker - the calls can live in it, and the plugin is not needed. `route(gate, children)` from `@expressive/rpc/http` is a gated layer, a plain object a path segment, a function a call; `handler(tree)` answers them:

```ts
// server/api.ts
import { route } from "@expressive/rpc/http";

export const api = route(() => void Session.new(), {
  claim: { search, create },
  admin: route(Admin, { users: { ban } }),
});
```

```ts
// server/index.ts - Bun
import { handler, scoped } from "@expressive/rpc/http";
import { api } from "./api";

const calls = handler(api, { base: "/api", errors: { Duplicate } });

Bun.serve(scoped({
  port: 8787,
  async fetch(request: Request) {
    return (await calls(request)) ?? routes(request);   // streams, uploads, files
  },
}));
```

```ts
// client
import { client } from "@expressive/rpc";
import type { api as Api } from "../server/api";

export const { api } = client<typeof Api>({ base: "/api", errors: { Duplicate } });

await api.admin.users.ban(7);
```

- `handler(tree)` gives a request that is not a call `undefined`. `Current`, `Cookies` and gates work in its calls as under the plugin; `scoped(app)` gives the app's own routes the same scope, what they set joining their response.
- The process loads its call modules itself - a long-lived job queue, db handle or `bun:sqlite` is shared with the calls.
- Import the tree as a type only - a value import ships server code to the client. Error classes come from a module both sides import.
- In dev, proxy the base to the server: `server: { proxy: { "/api": "http://localhost:8787" } }` in `vite.config.ts`.
- A gate is a function or Model class; it runs before every call beneath it.
- After the first `handler` or `scoped`, a static `Model.get()` outside a call throws - instructions (`get(JobManager)`) and Models' own lookups are unaffected.

## Build and deploy

Under the plugin, `vite build` emits `dist/client` and `dist/server/index.js`, a self-contained bundle holding only the calls the client imported - the app's entry, or by default `export default { fetch(request, env) }`, which hands non-call requests to `env.ASSETS` when bound, else 404. `cloudflare:` imports stay external.

It runs anywhere `fetch(request)` does - Workers is one target, not the default.

- **Cloudflare Workers:** `main: "dist/server/index.js"`, `compatibility_flags: ["nodejs_compat"]` (required), `no_bundle: true`, `assets: { directory: "dist/client", binding: "ASSETS", run_worker_first: true }`.
- **Node:** `toNode(server.fetch)` from `@expressive/rpc/http` is a `(req, res, next?)` handler - `next` gets what the server answers `undefined`; serve static files yourself.
  - It mounts in Express (or Firebase Functions' `onRequest`) like any middleware: `app.use(toNode(server.fetch))`.
  - To keep `node_modules` installed rather than bundled - native or heavy packages like `pg` and `firebase-admin` - set the server environment's own externals; rpc then bundles only the calls and what you name:

    ```ts
    export default defineConfig({
      plugins: [rpc()],
      environments: { rpc: { resolve: { noExternal: [] } } },   // or ["@expressive/rpc"] to bundle rpc too
    });
    ```

- **Bun:** `Bun.serve({ port, fetch: server.fetch })`, or call it from your own `fetch` and serve `dist/client` beside it. `env.ASSETS` is unbound, so a non-call is a 404 unless your `fetch` answers it.

Use `vite build` or `createBuilder().buildApp()` - the legacy `build()` API builds the client only.

## Limits

- Binary goes base64 inside the JSON body - fine for documents and images, not for large uploads; take those through a [server entry](#server-entry). No `Blob`, `File` or streams as arguments.
- Worker bindings (`env`) and `ctx` do not reach calls - import `env` and `waitUntil` from `cloudflare:workers`, or handle the request in the entry.
- Module state lives per isolate or process - keep shared state in a store.
- An error class extending a package's export (`extends ZodError`) is not followed; the server checks it is an `Error` at startup.

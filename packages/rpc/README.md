# @expressive/rpc

Typed server calls for any Vite client build. Put `async` functions in one folder; the client imports them like any module and gets stubs that call the server. Types come from the source - no schema, no codegen step.

```bash
npm install @expressive/rpc @expressive/mvc
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import rpc from "@expressive/rpc/vite";

export default defineConfig({ plugins: [rpc()] });
```

`dir` (default `"api"`) is relative to Vite's root and may sit outside it - `rpc({ dir: "../api/src" })` for calls in a sibling workspace package; its tsconfig path aliases resolve with `resolve: { tsconfigPaths: true }`.

```ts
// api/todos.ts
import { NotFound } from "@expressive/rpc";

export async function done(id: string) {
  const todo = await db.todos.get(id);
  if (!todo) throw new NotFound(`No todo ${id}.`);

  return db.todos.update(id, { done: true });
}
```

```ts
// src/main.ts
import { NotFound } from "@expressive/rpc";
import { done } from "../api/todos";

try {
  await done(id);
} catch (error) {
  if (error instanceof NotFound) refresh();
}
```

`vite build` emits the client in `dist/client` and a server bundle in `dist/server/index.js` - `export default { fetch }` - that runs anywhere `fetch(request)` does: a Cloudflare Worker (with `nodejs_compat`), `Bun.serve({ fetch: server.fetch })`, or Node through `toNode(server.fetch)` from `@expressive/rpc/http`.

An app that already runs its own server - say, a long-lived Bun process holding a job queue and a database - skips the plugin: it builds the calls as a tree and serves them from its own `fetch`, and the client calls them typed.

```ts
// server - Bun
import { handler, route, scoped } from "@expressive/rpc/http";

export const api = route(() => void Session.new(), { jobs: { list, cancel } });

const calls = handler(api, { base: "/api" });

Bun.serve(scoped({ port: 8787, fetch: async request => (await calls(request)) ?? routes(request) }));
```

```ts
// client
import { client } from "@expressive/rpc";
import type { api as Api } from "../server";

export const { api } = client<typeof Api>({ base: "/api" });
```

- **Errors** - `HttpError` and its subclasses (`NotFound`, `Forbidden`, `Conflict`, ...) set the reply's status and are rebuilt on the client, so `instanceof` works. Export your own subclasses from the folder - each crosses by its name (`"error": "Duplicate"`), unique across the app.
- **Groups** - a server module may export objects of calls imported from elsewhere in `dir` (`export const claim = { search, create }`), and re-export them. Each call keeps its defining module's path and gates. `test` (`rpc({ test: /(^|\/)index\.ts$/ })`) narrows which modules are server modules; the rest stay plain, stubbed only for the calls a server module reaches.
- **Gates** - an `index.ts` default runs before every call in its folder and below: a function, whose activated Models are the call's context and refuse it if their `new()` fails, or a `Model` with `static key()`. Throw to refuse. A function gate may wrap the call with `Current.get().next()`, or answer it with a returned `Response`.
- **Values** - `Date`, `BigInt`, `Map`, `Set`, `Uint8Array` and `undefined` in arrays survive the trip, tagged inside plain JSON.
- **Cookies** - declare them as fields of a `Cookies` subclass; `AppCookies.get().session` reads this request's, `AppCookies.set({ session: id })` sends `Set-Cookie` with the reply.
- **Request** - `Current.get().request`, `.url`, `.cookies`, `.env` and `.ctx` (the `env` and `ctx` the server's `fetch` got) inside a call, and `setHeader` for its reply. In a gate or the entry's routes, also `json()`, `text()` and `send()`.
- **Base path** - `rpc({ base: "/api" })` serves the calls under a prefix: stubs send there and the server matches it, with nothing to strip.
- **Addresses** - a call's place in the tree: `api/admin/users.ts#ban` posts to `/admin/users` as `ban`. Readable and stable across deploys; `rpc({ opaque: true })` seals the names in a build.
- **Client** - `configure({ base, headers, transport, reply, errors })` for cross-origin servers, auth headers, a custom fetch or error classes to rebuild as themselves. Any call takes `.with({ signal, timeout })`: `list.with({ timeout: 5000 })()`.
- **Your own server** - `route(gate, { ...calls })` and `handler(tree)` from `@expressive/rpc/http` serve calls from any process, no plugin; `Current`, `Cookies` and gates work as under the plugin, and `scoped(app)` extends them to the app's own routes. In dev, proxy the base to it from Vite.
- **Server entry** - `rpc({ entry: "server.ts" })` makes your own Worker-shaped module the server: it gets the calls as `handle(request)` from `@expressive/rpc/calls` and adds routes, a `scheduled` handler or Durable Objects beside them, sharing their modules in dev and build. Its routes run in the request's scope, so `Current` and `Cookies` work there as in a call. In Hono, `handle` is middleware: `app.use(async (c, next) => (await handle(c.req.raw)) ?? next())`.

Full reference: [skills/expressive-rpc](https://github.com/gabeklein/expressive/blob/main/packages/rpc/skills/expressive-rpc/SKILL.md), shipped in the package. A runnable app is in [`example/`](https://github.com/gabeklein/expressive/tree/main/packages/rpc/example).

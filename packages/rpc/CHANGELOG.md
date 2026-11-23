# @expressive/rpc

## 0.5.1

### Patch Changes

- [#796](https://github.com/gabeklein/expressive/pull/796) [`0d6873a`](https://github.com/gabeklein/expressive/commit/0d6873a44c9e8e2bf3acf3f18fe97035c96e60f7) `send` waits for the response to drain before writing more, and cancels the body when the connection closes - a slow or gone client no longer buffers a whole streamed reply. A body that fails mid-stream aborts the response instead of ending it.

## 0.5.0

### Minor Changes

- [#774](https://github.com/gabeklein/expressive/pull/774) [`54a571e`](https://github.com/gabeklein/expressive/commit/54a571e8a6902e0baedd38fac03239024fb92b46) `Current.get().env` reads the `env` the built server's `fetch` got (the plugin's `env` in dev, `{}` without). Type it by extending the exported `Env` interface.

## 0.4.4

### Patch Changes

- Updated dependencies [[`340759c`](https://github.com/gabeklein/expressive/commit/340759c8fa3a4b2b6b759e9082f8a731ee338ac2)]:
  - @expressive/mvc@0.97.0

## 0.4.3

### Patch Changes

- Updated dependencies [[`cf2e10b`](https://github.com/gabeklein/expressive/commit/cf2e10bb021364721007bf1102c76a53e8c67f25), [`0360067`](https://github.com/gabeklein/expressive/commit/0360067d50ff09d1cd72efdd5b3ee456151bfdd3), [`6711fd8`](https://github.com/gabeklein/expressive/commit/6711fd88de99b43fbb273fa0c78ebf6c6da7b414)]:
  - @expressive/mvc@0.96.0

## 0.4.2

### Patch Changes

- Updated dependencies [[`b968a6d`](https://github.com/gabeklein/expressive/commit/b968a6d4eac9a3f2b4de09f77ca13941b9ac8294), [`829ff1c`](https://github.com/gabeklein/expressive/commit/829ff1ca06cab12636cd64c25f11805e67f09b4e)]:
  - @expressive/mvc@0.95.0

## 0.4.1

### Patch Changes

- [#721](https://github.com/gabeklein/expressive/pull/721) [`0ba15e1`](https://github.com/gabeklein/expressive/commit/0ba15e14cddaa91acb635648e6f14d5f3ab2ba0e) `handler()` and `scoped()` from `@expressive/rpc/http` work in a server the app runs itself (`Bun.serve`, Node, a Worker), with no plugin and no `install()` call. Before, `Current`, a function gate's Models and `Current` in the app's own routes failed with "Could not find Current in context" unless `install()` from `/protocol` ran first. The docs cover serving calls from your own Bun server and a `Bun.serve` deploy for the built bundle.

## 0.4.0

### Minor Changes

- [#719](https://github.com/gabeklein/expressive/pull/719) [`a6d2e6e`](https://github.com/gabeklein/expressive/commit/a6d2e6e8aed323e6e7dc74104a6bec8951d85656) `rpc({ base: "/api" })` serves the calls under a path prefix. Stubs send to it, and `handle(request)` - in the default server, the dev server or an app's entry - answers only beneath it, given the full request, so an entry no longer strips the prefix itself. `handler()` from `@expressive/rpc/http` takes the same `base`. The server-entry docs add a Hono recipe: `handle` as middleware, without `mount()` or a cast.

- [#719](https://github.com/gabeklein/expressive/pull/719) [`a6d2e6e`](https://github.com/gabeklein/expressive/commit/a6d2e6e8aed323e6e7dc74104a6bec8951d85656) The server is a tree of calls you could write by hand. `route(gate, children)` and `handler(tree, { base, errors })` from `@expressive/rpc/http` serve one without the plugin, and the plugin's own server is that same tree.

  Breaking:

  - A call's address is its place in the tree: `api/admin/users.ts#ban` posts to `/admin/users` as `ban`, where it was `/admin` as `users:ban`.
  - Builds keep readable names. `rpc({ opaque: true })` seals them.
  - An exported Error class crosses by its export name (`Duplicate`), unique across the app - two classes under one name fail the build.
  - `with` and `then` are reserved: no call, module or folder may take them.

  Client:

  - `client<T>().api` is a typed tree of calls, and the shared client's `api` backs every stub.
  - Any node or call takes `.with({ signal, timeout })` - an abort rejects with the signal's reason, a timeout with a `TimeoutError`.
  - `errors: { Duplicate }` in `client()` or `configure()` rebuilds a thrown error as that class.

  In dev, a thrown Error subclass the server does not know warns once, naming its class - a build replies "Internal error." for it.

## 0.3.0

### Minor Changes

- [#710](https://github.com/gabeklein/expressive/pull/710) [`f722198`](https://github.com/gabeklein/expressive/commit/f722198d8ae0b9fb99ad0c82e8d48c01f604085e) A folder's gate may be a function: an index's default run before each call in its folder and below. The Models it activates, and those they activate while settling, belong to that call. They are in reach of `.get()`, waited on until ready, and destroyed when it ends, and one whose `new()` fails refuses the call with its error, unreported.

- [#661](https://github.com/gabeklein/expressive/pull/661) [`35f2d80`](https://github.com/gabeklein/expressive/commit/35f2d8084dc95ca542bc3c1eedef7a4caddb74d7) A folder's gate runs per request by default: its instance ends after the last call holding it, so a logout or revoked session takes effect on the next call. `static ttl` still caches one per key, and `set(null)` on it ends it early. dev keeps its seats for 300 seconds by default, as before.

- [#712](https://github.com/gabeklein/expressive/pull/712) [`8503354`](https://github.com/gabeklein/expressive/commit/8503354dff1f64f65ec1f1d30e40c72c8fcc888b) A server module may export groups - objects of calls and Error classes imported from elsewhere in `dir` - and re-export them. Each call keeps its defining module's path, id and gates. The new `test` option narrows which modules under `dir` are server modules: the rest stay plain, stubbed only for the calls a server module groups or re-exports, and a folder's gate is the default of its index only when `test` selects it.

### Patch Changes

- Updated dependencies [[`b7be047`](https://github.com/gabeklein/expressive/commit/b7be047c229a1bcaeb7906b660261e2b64edc584)]:
  - @expressive/mvc@0.94.5

## 0.2.0

### Minor Changes

- [#662](https://github.com/gabeklein/expressive/pull/662) [`40a1ef0`](https://github.com/gabeklein/expressive/commit/40a1ef0ba97257ce936ff318b6768f600c2910e7) The server entry's `fetch` runs in the request's scope: `Current` and `Cookies` work in its routes as in a call, and the headers and cookies they set join the route's response. `scoped(app)` from `@expressive/rpc/http` does the same for a host wrapping an entry itself.

- [#663](https://github.com/gabeklein/expressive/pull/663) [`3042161`](https://github.com/gabeklein/expressive/commit/3042161db2e9c77999826f84cb9fc60a9736a3b2) The server bundle honors the app's own `environments.rpc.resolve` externals: set `noExternal` (or `external`) and dependencies stay installed instead of bundled - for a Node server with `pg` or `firebase-admin`. Without either, it still bundles everything for a Worker. The calls module is bundled either way.

### Patch Changes

- Updated dependencies [[`ea0f0c6`](https://github.com/gabeklein/expressive/commit/ea0f0c63ea5d1a689084a6bc170f47087b0c05f0)]:
  - @expressive/mvc@0.94.3

## 0.1.1

### Patch Changes

- [#651](https://github.com/gabeklein/expressive/pull/651) [`173a60c`](https://github.com/gabeklein/expressive/commit/173a60ce8245f509da4a1735c4788472dea5462e) Ship each package's agent skill in the package, at `skills/expressive-<pkg>/SKILL.md`, so the docs an agent reads match the installed version. `npx skills experimental_sync` links them into `.claude/skills/` and `.agents/skills/`; `expressive-mvc` holds the core, and each package's skill links its siblings as installed side by side. On expressive.dev the skills move to `/llm/expressive-<pkg>/`, with the old `/llm/` paths redirecting.

- [#672](https://github.com/gabeklein/expressive/pull/672) [`f0e6e70`](https://github.com/gabeklein/expressive/commit/f0e6e7033237aef547d4088e69df1ced13e6880b) Skill corrections: inspect's `caught` kinds and `site`, rpc's `Redirect` status, router's guard rejection and `Redirect` timing, dom's status, dev's hand-written Vite config needing `inspect()`, and steps linking the mvc skill.

- [#668](https://github.com/gabeklein/expressive/pull/668) [`f9eabf1`](https://github.com/gabeklein/expressive/commit/f9eabf14a39c91e069072dacbaff02657289685f) Fix the skill's frontmatter, which was invalid YAML, so skill installers skipped it.
- Updated dependencies [[`5fec34c`](https://github.com/gabeklein/expressive/commit/5fec34c05a268718f4dec2bdafd13de22264821c), [`11e3c48`](https://github.com/gabeklein/expressive/commit/11e3c48fbb1f27e80128a5209c5ad2ff099ddd64), [`173a60c`](https://github.com/gabeklein/expressive/commit/173a60ce8245f509da4a1735c4788472dea5462e)]:
  - @expressive/mvc@0.94.2

## 0.1.0

### Minor Changes

- [#644](https://github.com/gabeklein/expressive-mvc/pull/644) [`bdc4c77`](https://github.com/gabeklein/expressive-mvc/commit/bdc4c77db1ed0b52c26b0cba1ce03c306416d3d4) First release. Typed server calls for any Vite client build: `rpc()` from `@expressive/rpc/vite` turns a folder of `async` functions (`api/` by default) into client stubs and a server bundle that runs as a Cloudflare Worker or under Node through `toNode`. Ships the `HttpError` family rebuilt on the client, folder gates through an index's default Model and its `static key()`, `Cookies` - a Model of the request's cookies whose changed fields go out as `Set-Cookie` - and `Current` for the request in a call, and `configure({ base, headers, transport, reply })` for the client. `rpc({ entry })` takes the app's own server module - routes, `scheduled` and Durable Objects beside the calls, which it gets from `@expressive/rpc/calls` - runs it on the dev server and bundles it as the server. Arguments and results carry `Date`, `BigInt`, `NaN`/`Infinity`, `Map`, `Set`, `Uint8Array` and `undefined` in arrays, tagged inside plain JSON.

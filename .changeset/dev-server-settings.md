---
"@expressive/dev": minor
"@expressive/rpc": minor
---

dev: `index.ts`'s settings take a new shape. `config` comes from `@expressive/dev`. `handle({ request, env, ctx, next })` is fetch middleware around every request the host forwards - calls, pages and static files - replacing `fetch` and `around`: return a `Response` to answer, nothing to pass, or wrap `next()`. `host(app)` builds the fetch target's default export, for platform handlers such as `scheduled`; it gets a default `fetch`. `compose(settings)` from `/server` builds the app for tests. Keys 0.6 does not read - `fetch`, `around`, `scheduled` - and a named `bindings` export fail the dev server and the build, each naming its new home. In dev, Vite's own requests skip `handle`, and a request it passes that is neither a file nor a navigation goes on to Vite's middlewares. `AppConfig` is `Settings`; the generated entries call `listen` and `/fetch`'s `compose` in place of `serve` and `fetchHandler`.

rpc: `Current.get().params` in a sidecar call holds its folder's params, decoded - `{ slug: "a" }` for a call to `/blog/a` under `blog/:slug`.

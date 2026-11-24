---
"@expressive/dev": minor
---

`index.dev.ts`: when it exists, `expressive dev` reads its default export in place of `index.ts`'s. It imports `index.ts`'s settings, sets `env()` - the bindings a host would pass, such as a local database for `DB` - and exports them. The build never reads it, so nothing it imports reaches a bundle. Dev calls `env()` once per server, and again only after it throws - a change to it needs a restart. An `index.dev.ts` without a default export, or with an `env` that is not a function, fails by name. `env` set in `index.ts` fails the dev server and the build.

On Node and in dev, `handle`'s `env` and `Current.get().env` are a read-only view: `env()`'s keys (dev), then `process.env`, then the `.env` files - previously `{}`. The fetch target still passes the host's `env` as is.

`Env` from `@expressive/dev` now carries the keys `expressive env` declares in `env.d.ts`, beside those an app adds with `declare module "@expressive/dev" { interface Env { … } }`.

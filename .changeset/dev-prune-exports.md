---
"@expressive/dev": minor
---

Remove exports with no use outside dev itself.

- `hydrate` leaves the root - an app that calls it installs `@expressive/dom` and imports it from there.
- `runDev` and `DevOptions` leave `@expressive/dev/vite` - run `expressive dev`. For a hand-written Vite config, add `expressive()` with `@expressive/dom/vite` beside it for hot reload, `env()` from `@expressive/env/vite`, and `inspect()` from `@expressive/inspect/vite` for the relay; call `register()` from `@expressive/env` first to copy `.env` files into `process.env`.

The generated client entry and calls module resolve `@expressive/dom` and `@expressive/rpc` through dev, so an app installed with pnpm or another isolated layout builds with only `@expressive/dev` and `@expressive/mvc` installed.

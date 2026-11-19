---
"@expressive/env": minor
---

`expressive env` alone writes `env.d.ts` and warns of unset keys without failing - a setup step for `prepare` scripts. The Vite plugin no longer creates `env.d.ts` on dev start (it refreshes one that exists), defers to an earlier `env()` in the same config, and drops from a bundle when nothing reads `env`.

`register()` (and `@expressive/env/register`, for `node --import`) copies the mode's `.env` files into `process.env` for dependencies that read it - imported first or preloaded with `node --import`. Keys already set win.

---
"@expressive/env": minor
---

`expressive env` alone writes `env.d.ts` and warns of unset keys without failing - a setup step for `prepare` scripts. The Vite plugin no longer creates `env.d.ts` on dev start (it refreshes one that exists), defers to an earlier `env()` in the same config, and drops from a bundle when nothing reads `env`.

`register()` copies the mode's `.env` files into `process.env` for dependencies that read it - call it before they load, or preload `@expressive/env/register` with `node --import`. Keys already set, and `NODE_ENV`, are left alone.

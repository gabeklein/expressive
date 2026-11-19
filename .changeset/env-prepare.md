---
"@expressive/env": patch
---

`expressive env` alone writes `env.d.ts` and warns of unset keys without failing - a setup step for `prepare` scripts. The Vite plugin no longer creates `env.d.ts` on dev start (it refreshes one that exists), defers to an earlier `env()` in the same config, and drops from a bundle when nothing reads `env`.

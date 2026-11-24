---
"@expressive/dev": minor
---

A remote entry's default - its folder's gate - now runs on the `fetch` target, before each call through the folder, as it does on Node and in dev. A gated remote entry no longer fails a `target: "fetch"` build.

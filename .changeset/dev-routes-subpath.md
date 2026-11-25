---
"@expressive/dev": minor
---

`gateCheck` moves from the root to `@expressive/dev/routes`, a subpath for generated code only, beside the path an entering route's hook runs for - a module variable shared with the root's `Route` in place of a `Symbol.for` global.

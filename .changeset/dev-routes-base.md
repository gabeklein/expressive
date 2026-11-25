---
"@expressive/dev": minor
---

Remote calls and gate checks honour a non-root Vite `base`: the browser posts under it and fills `[param]` segments from the path below it, and dev, the Node server and the `fetch` build answer calls only under it.

`gateCheck` moves from the root to `@expressive/dev/routes`, a subpath for generated code only, beside the path an entering route's hook runs for - a module variable shared with the root's `Route` in place of a `Symbol.for` global.

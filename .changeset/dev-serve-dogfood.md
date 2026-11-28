---
"@expressive/dev": patch
"@expressive/rpc": patch
---

In dev, `<path>/index.html` under `public/` answers its path, as `ASSETS` and the built server do; a thrown error in an `api/` route or gate shows its message, as one in `handle` does; and a 5xx after a `handle` that returned nothing warns once that a wrapping `handle` must `return next()` inside the wrapper. `@expressive/rpc/protocol`'s `layer` takes `dev` to show a 500's message.

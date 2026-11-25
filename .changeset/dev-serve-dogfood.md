---
"@expressive/dev": patch
"@expressive/rpc": patch
---

A remote call posts to its sidecar's own path, params filled from the page's location - a call from any page but the sidecar's own folder posted to the page's URL and got 404. In dev, `<path>/index.html` under `public/` answers its path, as `ASSETS` and the built server do; a thrown error in an `api/` route or gate shows its message, as one in `handle` does; and a 500 after a `handle` that returned nothing warns that a wrapping `handle` must `return next()` inside the wrapper. `@expressive/rpc/protocol`'s `layer` takes `dev` to show a 500's message.

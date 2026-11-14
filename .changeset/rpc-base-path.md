---
"@expressive/rpc": minor
---

`rpc({ base: "/api" })` serves the calls under a path prefix. Stubs send to it, and `handle(request)` - in the default server, the dev server or an app's entry - answers only beneath it, given the full request, so an entry no longer strips the prefix itself. `handler()` from `@expressive/rpc/http` takes the same `base`. The server-entry docs add a Hono recipe: `handle` as middleware, without `mount()` or a cast.

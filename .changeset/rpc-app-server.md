---
"@expressive/rpc": patch
---

`handler()` and `scoped()` from `@expressive/rpc/http` work in a server the app runs itself (`Bun.serve`, Node, a Worker), with no plugin and no `install()` call. Before, `Current`, a function gate's Models and `Current` in the app's own routes failed with "Could not find Current in context" unless `install()` from `/protocol` ran first. The docs cover serving calls from your own Bun server and a `Bun.serve` deploy for the built bundle.

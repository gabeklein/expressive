---
"@expressive/rpc": minor
---

A seat with `static ttl = false` (or `Infinity`) never expires; `Infinity` used to overflow the timer and drop the seat almost at once. `install({ ttl: false })` sets that as the default. `@expressive/rpc/protocol` adds `retire(Type?)`, which evicts one class's seats and pooled instances or, with no argument, every layer, and `stats()`, which counts layers, seats and pooled instances.

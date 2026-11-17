---
"@expressive/rpc": minor
---

A seat with `static ttl = false` (or `Infinity`) never expires; `Infinity` used to overflow the timer and drop the seat almost at once. `install({ ttl: false })` sets that as the default. `@expressive/rpc/protocol` adds `retire(Type?)`, which evicts the seats and pooled instances that are or own an instance of one class or, with no argument, every layer, and `stats()`, which counts layers, seats and pooled instances. A call still entering its seats or gates when `retire()` runs fails instead of building seats on the evicted layer.

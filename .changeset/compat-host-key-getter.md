---
"@expressive/react": patch
---

A Component class declaring its own getter on a key the host writes to its instances - preact's `base`, which `Route` from `@expressive/router` declares - no longer throws "is read-only" when rendered under `@expressive/react/compat`. The host's write is discarded, and the getter becomes a plain accessor instead of a computed.

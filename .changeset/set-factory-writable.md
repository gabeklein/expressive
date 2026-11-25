---
"@expressive/mvc": minor
---

`set()` factories are writable without a callback. `set(() => x)`, `set(async () => x)` and their `true`/`false` forms accept assignment like value forms - `profile = set(() => api.profile(), () => {})` becomes `profile = set(() => api.profile())`. A write takes over from the factory: before first access the factory never runs; while pending its result is discarded, suspended reads settle to the written value, a later rejection is dropped and a required factory's `ready` hold releases. A constructor arg seeds a required factory the same way, skipping it. Declare the field `readonly` to keep it read-only - TypeScript enforces it. The computed form, `set(self => ...)`, stays read-only.

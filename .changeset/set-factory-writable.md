---
"@expressive/mvc": minor
---

`set()` factories are writable without a callback. `set(() => x)`, `set(async () => x)` and their `true`/`false` forms accept assignment like value forms, so a no-op callback kept only for writability can go. Dropping it changes timing: `set(f, () => {})` runs on activation and lets the async result overwrite a write made while pending; `set(f)` runs on first read and the write wins - use `set(f, true)` to keep activation timing. A write takes over from the factory: before first access the factory never runs; while pending its result is discarded, suspended reads settle to the written value, a later rejection is dropped and a required factory's `ready` hold releases. A constructor arg seeds a required factory the same way, skipping it. A `readonly` field rejects direct assignment at compile time; constructor args and `set({...})` still write it. The computed form, `set(self => ...)`, stays read-only.

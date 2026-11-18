---
'@expressive/mvc': minor
---

A required factory, `set(factory, true)`, now runs during activation after constructor args apply, and while its result is pending it holds the instance's `ready` handlers, effects and `await state.set()` - and its parent's, like `async new()`. A rejection reports to `catch` as `setup` with the field's key and releases the hold without destroying the instance; reads still rethrow it.

Behavior changes: `ready` sees the field's value, and a server render waiting on `ready` waits for it. A synchronous throw from a required or seeded factory (`set(factory, onUpdate)`) fails activation - `new()` throws. Seeded factories also run before `ready` now, but do not hold it.

Custom instructions get the same step: `def` config takes an `init` hook, run on activation after constructor args - a returned promise holds `ready`, a throw fails activation.

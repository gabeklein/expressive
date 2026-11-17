---
'@expressive/mvc': minor
'@expressive/react': minor
'@expressive/dom': minor
---

A required factory, `set(factory, true)`, now runs during activation after constructor args apply, and while its result is pending it holds the instance's `ready` handlers, effects and `await state.set()` - and its parent's, like `async new()`. In a render, `Type.get()` suspends until every required factory on the found instance has settled, and throws a rejection there; a rejection releases the hold without destroying the instance.

Behavior changes: consumers that never read the field now suspend too, including in `renderToString`. `ready` sees the field's value. A synchronous throw from a required or seeded factory (`set(factory, onUpdate)`) fails activation - `new()` throws. Seeded factories also run before `ready` now, but do not hold it.

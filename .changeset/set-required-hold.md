---
'@expressive/mvc': minor
'@expressive/react': minor
'@expressive/dom': minor
---

A required factory, `set(factory, true)`, now runs during activation after constructor args apply, and while its result is pending it holds the instance's `ready` handlers, effects and `await state.set()`. In a render, `Type.get()` suspends until every required factory on the found instance has settled, and throws a rejection there. Behavior change: consumers that never read the field now suspend too, and `ready` sees its value. A rejection releases the hold without destroying the instance. Seeded factories (`set(factory, onUpdate)`) also run before `ready` now, but do not hold it.

---
'@expressive/mvc': minor
---

`set(factory)` now awaits any thenable its factory returns, not only a `Promise` - reads suspend until it resolves and a rejection rethrows, and the field types as the `Awaited` value. Behavior change: a factory returning an object with a `then` method used to store that object; it now stores what `then` resolves to - for a `@expressive/steps` instance, the result of a run. A thenable Model the factory constructs activates owned by the instance and is destroyed once it settles, unless it resolves to itself. A thenable passed directly as `set(value)` throws the direct-promise TypeError. Types now need TypeScript ≥ 5.4 (`NoInfer`).

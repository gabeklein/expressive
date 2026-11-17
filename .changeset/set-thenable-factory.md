---
'@expressive/mvc': minor
---

`set(factory)` now awaits any thenable its factory returns, not only a `Promise` - reads suspend until it resolves and a rejection rethrows, and the field types as the `Awaited` value. Behavior change: a factory returning an object with a `then` method used to store that object; it now stores what `then` resolves to. `set(value)` likewise rejects a thenable `value` with the direct-promise TypeError.

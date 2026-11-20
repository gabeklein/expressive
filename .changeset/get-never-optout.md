---
'@expressive/mvc': minor
---

A value is left out of `get()` snapshots when its `get` throws `false` - a getter (`get get(): never { throw false }`) or a parameterless method (`get(): never { throw false }`) - replacing `get: null`, which is now ordinary data and exports as is. Any other throw from that `get`, such as a suspense Promise or an `Error`, propagates. `Model.Values` and `Model.Partial` type a field `never` when its `get` is typed `never` (`get: never` or `get(): never`). `ref(this)` and `ref(this, fn)` proxies move to the new form, typed `get(): never`. `map()` and `has()` snapshots keep such values as is.

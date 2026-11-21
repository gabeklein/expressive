---
'@expressive/mvc': minor
---

A value is left out of `get()` snapshots when its `get` throws `false` - a getter (`get get(): never { throw false }`) or a parameterless method (`get(): never { throw false }`) - replacing `get: null`, which is now ordinary data and exports as is. Any other throw from that `get`, such as a suspense Promise or an `Error`, propagates. `Model.Export` gives `never` for a value whose `get` is typed `never` (`get: never` or `get(): never`), so `Model.Values`, `Model.Partial` and `Model.Value` type such a field `never`. `ref(this)` and `ref(this, fn)` proxies move to the new form, typed `get(): never`. `map()` and `has()` snapshots keep such values as is, typed by the new `Model.Item<R>`. A `get()` snapshot taken after an earlier one threw no longer returns stale nested values.

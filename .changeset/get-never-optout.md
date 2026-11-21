---
'@expressive/mvc': minor
---

A value is left out of `get()` snapshots when its `get()` throws `false` (`get(): never { throw false }`), replacing `get: null`, which is now ordinary data and exports as is. The opt-out is meant for instruction values with nothing to export. Any other throw from that `get()`, such as a suspense Promise or an `Error`, propagates. `Model.Export` gives `never` for a value whose `get()` returns `never`, so `Model.Values`, `Model.Partial` and `Model.Value` type such a field `never`. `ref(this)` and `ref(this, fn)` proxies move to the new form. `map()` and `has()` snapshots now leave such values out too, so a snapshot's indices or size can differ from the live collection's. A `get()` snapshot taken after an earlier one threw no longer returns stale nested values.

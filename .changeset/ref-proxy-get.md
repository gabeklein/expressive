---
'@expressive/mvc': minor
---

A value whose `get` is `null` is omitted from `get()` snapshots, and `Model.Values` and `Model.Partial` type its field `never`. `ref(this)` and `ref(this, map)` proxies carry it, replacing a declared `get()` that threw at runtime.

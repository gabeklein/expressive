---
'@expressive/mvc': minor
---

A value whose `get` is `null` is omitted from `get()` snapshots and from `Model.Values`. `ref(this)` and `ref(this, map)` proxies carry it, so they no longer appear in either, and their type no longer declares a `get()` that threw at runtime.

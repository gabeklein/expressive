---
'@expressive/mvc': minor
---

`get()` snapshots call a value's `get` only when it declares no parameters, matching `Model.Values`: a native `Map` field exports as the `Map` instead of `undefined`, and `map()` / `has()` snapshots keep such nested values as is. Functions now export through their `get` too, so a `ref` handle held by another field exports its value instead of the handle, and a function with `get: null` is omitted. A custom `get` with an optional parameter must declare it as rest (`get(...[key]: [K?])`) to keep exporting through it.

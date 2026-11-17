---
'@expressive/mvc': patch
---

`ref(this)` and `ref(this, map)` proxies now implement the typed `get()`, returning the source instance. It was declared but threw at runtime.

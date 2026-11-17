---
'@expressive/mvc': patch
---

`ref(this)` and `ref(this, map)` proxies implement their declared `get()`, returning the source instance; it previously threw.

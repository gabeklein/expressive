---
"@expressive/dom": patch
---

`hydrate()` adopts a suspended subtree's server markup when it holds a hoisted `<title>`, `<meta>` or `<link>`, instead of rebuilding it and leaving a duplicate in the head.

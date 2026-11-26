---
"@expressive/dom": patch
---

A `catch` boundary with `fallback={false}` passes suspension to the nearest ancestor with a fallback, as documented and as React does, instead of hiding its content.

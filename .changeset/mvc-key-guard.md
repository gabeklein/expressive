---
"@expressive/mvc": minor
---

A key passed to a Model that doesn't handle one now throws. Base `Model.get("id")` used to ignore the key and return whatever instance was in context; base `Model.new("id")` dropped it. Override `static get` (or `static new`) to resolve a key.

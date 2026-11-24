---
"@expressive/mvc": minor
---

A key passed to a Model that doesn't handle one now throws. Base `Model.get("id")` - also reached through `state.get(Type, "id")` and the `get(Type, "id")` instruction - used to ignore the key and return whatever instance was in context; `Model.new("id")` and `new Model("id")` dropped it. Override `static get` to resolve a key.

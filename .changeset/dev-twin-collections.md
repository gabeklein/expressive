---
"@expressive/dev": minor
---

Twins carry `has()` pools of Model classes: the twin's field is a read-only pool of member twins, each patched on its own, with member methods called through the owner. A public `has()` of plain values or a factory now fails the build instead of arriving as an empty object.

---
"@expressive/mvc": patch
---

A getter read inside an effect or a `new()` keeps updating after that effect stops or that instance is destroyed.

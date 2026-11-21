---
'@expressive/mvc': patch
---

`Model.Values` no longer fails with "circularly references itself" on classes that reference each other and inherit a getter returning a mapped type over `this`, such as an ORM entity's `columns`. A regression in 0.97.0.

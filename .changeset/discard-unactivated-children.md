---
"@expressive/mvc": patch
---

Destroying a Model before it activates now destroys the Models its fields built - plain fields and array members - instead of leaving them to report `unused` at the next microtask.

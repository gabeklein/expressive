---
"@expressive/mvc": patch
---

Destroying a Model before it activates now destroys the still-pending Models its fields hold - plain fields and array members - and releases Models an instruction field was given or replaced, instead of leaving them to report `unused` at the next microtask.

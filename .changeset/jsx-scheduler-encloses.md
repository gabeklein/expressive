---
'@expressive/jsx': patch
---

A transition holding an empty scope behind the scope around it no longer reads DOM globals, so it works under any host.

---
"@expressive/mvc": patch
---

A `set()` factory or a getter that throws on its first read no longer logs a warning. The error is still rethrown to the code that read it. Errors that happen out of turn are unchanged and still report to `Model.on({ catch })`.

---
"@expressive/mvc": patch
---

A `set()` factory that throws on its first read no longer logs a warning. The error is still rethrown to every read, so the code that read it can handle it. A computed or getter that throws on its first compute still warns.

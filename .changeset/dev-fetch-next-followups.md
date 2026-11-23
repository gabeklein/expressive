---
"@expressive/dev": patch
---

The Node server serves `.xml` and `.webmanifest` with their types, and a malformed path falls through to the shell instead of failing the request.

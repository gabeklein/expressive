---
"@expressive/dev": patch
---

Static files open on first read, so a `next()` response the app discards holds no file open. Dev's `next()` no longer marks `public/assets/` immutable, and a malformed path falls through instead of failing. `.xml` and `.webmanifest` are served with their types.

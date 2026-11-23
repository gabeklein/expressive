---
"@expressive/dev": minor
---

The app's `fetch` gets `next()` as a fourth argument, resolving what the request gets without it - to return or rewrite. On Node it is the file, page or shell from `dist/client`, else 404; in dev, a `public/` file, else the shell as Vite transforms it; on the `fetch` target, 404, since static files are the host's there.

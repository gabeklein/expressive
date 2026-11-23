---
"@expressive/dev": patch
---

The server build no longer copies `public/` into `dist/server` - it is served from `dist/client`, where the client build puts it. Server code reading a public file resolves it from `../client/`.

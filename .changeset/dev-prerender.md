---
"@expressive/dev": minor
---

`expressive dev build` now prerenders: each static page is rendered with `renderToString` into `dist/client/<path>/index.html`, and the client hydrates it. `--no-html` (or `runBuild(root, { html: false })`) opts out, and a failed prerender step warns and keeps the client-only build. Folders with a remote are left to the client. A `[param]` or `[...]` route module lists its pages with a `paths()` export. The empty shell is kept as `200.html`, which the built service falls back to. `hydrate` is exported beside `render`.

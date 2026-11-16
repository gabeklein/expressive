---
"@expressive/dev": minor
---

`runBuild(root, { prerender: true })` from `@expressive/dev/vite` renders each static page with `renderToString` into `dist/client/<path>/index.html`, and the client hydrates it. A `[param]` or `[...]` route module lists its pages with a `paths()` export. The empty shell is kept as `200.html`, which the built service falls back to. `hydrate` is exported beside `render`.

---
"@expressive/dom": minor
---

`renderToString` from `@expressive/dom/server` renders a node to markup and the style rules it emits, without a DOM. Suspense is awaited in place, effects never run, and owned instances are destroyed afterwards.

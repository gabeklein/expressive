---
"@expressive/dom": patch
---

`renderToString` renders through the same reconciler as `render()`, so server and client resolve components, context, `catch` and suspense one way. A server render does not wait on a void required `set` factory, as readiness never gates render. Head elements keep document order when an earlier one suspends.

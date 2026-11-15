---
'@expressive/dom': patch
---

A value that can't render now names what it is and the component being rendered: `Cannot render an instance of Promise in Page.` instead of `Cannot render [object Object].` An unusable element type reads `Cannot use null as an element type.`, and now throws a `TypeError`. An element or portal made by a second copy of `@expressive/dom`, such as one loaded during a Vite dependency re-optimization, is named as such.

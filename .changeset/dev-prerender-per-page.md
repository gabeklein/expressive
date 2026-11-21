---
"@expressive/dev": minor
---

Prerendering skips by page, not by folder. A `remote.ts` or `remote/` no longer leaves its folder and everything below it unrendered: every page renders at build, and remote stubs stop at the server there - calling a remote function or twin method, or reading a twin's field, aborts that page's render and leaves it alone to the browser. A remote at the root of `app/`, shared by many screens, no longer disables prerendering for static pages beside it, and a seat no longer blocks pages under it that never read it. The build never runs server code.

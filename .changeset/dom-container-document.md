---
"@expressive/dom": patch
---

`render` and `hydrate` create nodes in the container's own document rather than the global `document`, so rendering into an iframe or another document works. A `Portal` selector resolves against that document.

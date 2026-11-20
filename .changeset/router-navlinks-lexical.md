---
"@expressive/router": minor
---

`NavLinks` lists routes declared after it on its first render, so a sidebar ahead of the page is complete in server-rendered and prerendered HTML instead of an empty list. A scope with content of its own is always listed as a link.

Breaking: `Item` and `Group` receive `route` as a `NavLinks.Entry` (`path`, `to`, `label`, `meta`) instead of a live `Route` - annotate overrides with `route: NavLinks.Entry`. `branch()` is now protected.

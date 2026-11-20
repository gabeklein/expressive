---
"@expressive/router": minor
---

`NavLinks` lists routes declared after it on its first render, so a sidebar placed ahead of the page renders complete on the server and in prerendered HTML instead of an empty list. It reads the declared `<Route>` JSX until routes mount. Breaking: `Item` and `Group` now receive `route` as a `NavLinks.Entry` (`path`, `to`, `label`, `meta`) instead of a live `Route` - change override annotations from `route: Route` to `route: NavLinks.Entry`.

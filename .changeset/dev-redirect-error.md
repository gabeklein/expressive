---
"@expressive/dev": minor
---

`Redirect` from `@expressive/dev` is now the router's error rather than a component: `throw new Redirect(to)` from a page, a class `Page` or a Component's `new()`, and the route navigates - before reaching the folder's `Catch`.

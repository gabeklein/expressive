---
"@expressive/dev": patch
"@expressive/router": patch
"@expressive/dom": patch
---

A route's `default` Component class now renders its `render()` around the route's content - beside a `Layout`, without one and at the root - where it was only provided. A `default` imported from another module (`import { Auth } from "lib/auth"; export default Auth`) is told apart from an entry hook when the route loads, so a class no longer runs as a hook. The root `index.tsx` page alone renders at `/` beside a root `[...]` page, which answers its folder's own path only without an index. A custom `index.html`'s relative links resolve from the root in dev on a nested path, as in the build. A page whose Model's async `new()` rejects while it prerenders is skipped with a warning instead of ending the build; one rejecting after its page rendered warns. An imported `default` that is a class but not a Model or Component throws naming its route.

In router, an index route and a catch-all beside it no longer both render at the index's path - the first declared wins, as for any other siblings, so a catch-all declared before an index now shadows it.

In dom, a transition no longer hoists an empty scope ahead of an enclosing scope that is going away in the same update - it runs after it - so a page on its way out does not render against the next page's state, and a `Redirect` in its `none` route no longer cancels the navigation.

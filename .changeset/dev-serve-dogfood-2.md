---
"@expressive/dev": patch
"@expressive/router": patch
"@expressive/dom": patch
---

A route's `default` Component class now renders its `render()` around the route's content - beside a `Layout`, without one and at the root - where it was only provided. A `default` imported from another module (`import { Auth } from "lib/auth"; export default Auth`) is told apart from an entry hook when the route loads, so a class no longer runs as a hook. The root `index.tsx` page alone renders at `/` beside a root `[...]` page, which answers its folder's own path only without an index; the gate check reads `[...]` the same way. A custom `index.html`'s relative links resolve from the root in dev on a nested path, as in the build. A page whose Model fails its async `new()` at prerender is skipped with a warning instead of ending the build.

In router, an index route and a catch-all beside it no longer both render at the index's path - the first declared wins, as for any other siblings.

In dom, a transition no longer renders an empty scope before a scope around it that the same update re-renders, so a page on its way out does not render against the next page's state - a `Redirect` in its `none` route no longer cancels the navigation.

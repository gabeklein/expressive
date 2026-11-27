---
"@expressive/jsx": patch
"@expressive/react": patch
"@expressive/router": patch
---

A `Redirect` thrown while rendering during a pushed in-app navigation keeps the current screen until its target is ready, instead of flashing the Route `fallback` - on `@expressive/dom` and on React 18+ with a concurrent root. Preact, older React, cold loads and replacing navigations still show the fallback. A `Redirect` from a second copy of the router is now recognized too.

---
"@expressive/jsx": patch
"@expressive/react": patch
"@expressive/router": patch
---

A render-time `Redirect` during held navigation keeps the current screen through the redirect until its target is ready, instead of flashing the Route fallback between the two navigation stages.

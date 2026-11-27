---
"@expressive/dev": patch
---

Prerendering now leaves pages that throw `Redirect` or `NotFound` to the browser without a per-page warning, counting them in the build summary instead. In development, an index route's visual `default` warns by module name when it drops its `Layout`, `Page`, and nested route children.

---
"@expressive/dev": patch
---

Prerendering now leaves pages that throw `Redirect` or `NotFound` - a redirect off the site included - to the browser without a per-page warning, counting them in the build summary instead. A `paths()` entry no route matches warns. Route generation warns, by module, when an index `default` never reads its `children` while the module has a `Page` or `Layout` or the folder has routes below.

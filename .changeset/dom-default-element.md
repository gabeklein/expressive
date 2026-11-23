---
"@expressive/dom": minor
---

`@expressive/dom` renders mvc's own element and no longer registers a JSX host - the package has no import side effects. Unmatched `_name` warnings now depend on each element coming from the dev runtime, not on any dev element having been created in the process.

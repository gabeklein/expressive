---
"@expressive/dom": minor
---

`@expressive/dom` renders the JSX runtime's default element and no longer registers a JSX host - the package has no import side effects. Unmatched `_name` warnings now come only from elements made by the dev runtime - not `createElement` or a production build - rather than turning on for the whole process. An element from another copy of `@expressive/dom` now renders instead of throwing; one from another JSX host (such as `@expressive/react` imported in the same build) throws naming it.

---
"@expressive/mvc": minor
"@expressive/jsx": minor
"@expressive/react": minor
---

`<Component for={instance}>` renders a provided Component instance around its children. New children re-render it without replacing its construction props or resetting its fields. The element's `fallback` and `catch` cover the placed render.

Host authors can read the provider's children through `placement(instance)` from `@expressive/mvc/host`; it returns `undefined` when the instance is not placed.

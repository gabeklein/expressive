---
"@expressive/jsx": patch
---

When a `catch` boundary handles a component's render error, content inside that component no longer renders before the error reaches `catch`, or while it recovers - updates queued inside it wait until it renders again. A route guard rejecting during a transition reaches `catch` without rendering the page below it.

---
"@expressive/jsx": patch
---

Content inside a component whose render fails no longer renders before the error reaches `catch`, or while it recovers - updates queued inside it wait until it renders again. A route guard rejecting during an in-app navigation shows `Catch` without rendering the page below it.

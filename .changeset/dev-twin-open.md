---
"@expressive/dev": minor
---

`Render.open(key)` twins an instance the server already holds, found by the class's `static open(key)` after the route's `key()` gates. dev refuses an instance no seat of the request owns, and releasing the twin leaves the instance alive. An opened twin whose instance is gone after a server restart reports the 404 to its `catch` as `effect` and keeps its last values.

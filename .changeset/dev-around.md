---
"@expressive/dev": minor
---

`config({ around(next, { request, env, ctx }) })` wraps every remote call and the app's `fetch` on each host - Node, the `fetch` target and dev - for per-request context such as a database session: `around: next => db.session(next)`.

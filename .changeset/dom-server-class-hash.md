---
"@expressive/dom": patch
---

`renderToString` names classes with a hash of their rule, so a server rule can no longer style a client element or another render's element of the same name. Hydration moves elements to the client's class names.

---
"@expressive/dom": patch
---

`renderToString` class names now end in a hash of their rule (`Card-1au4xe2`) rather than the plain label, so a server rule can no longer style a client element of the same name. Hydration moves elements to the client's names. Selectors written against server-rendered class names need updating.

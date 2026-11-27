---
"@expressive/mvc": patch
---

A getter first read inside an effect or a `new()` keeps updating after that effect stops or that instance is destroyed. Before, it kept the value from that read - a route default that read `router.match` and was then refused left the router's `match` stuck on the old path.

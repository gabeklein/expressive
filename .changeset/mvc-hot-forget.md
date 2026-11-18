---
"@expressive/mvc": minor
---

`@expressive/mvc/hot` exports `forget()`, which drops every class `accept` has seen so a host restarting from scratch gets each module's own classes back on its next run, instead of the first-loaded class whose field initializers still read the old module's imports.

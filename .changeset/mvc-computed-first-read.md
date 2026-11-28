---
"@expressive/mvc": patch
---

A getter read inside an effect or a `new()` keeps updating after that effect stops or that instance is destroyed. Listeners on longer-lived models are now released immediately when a model is destroyed, or when a React or jsx reader unmounts. An effect that stops itself while running stays stopped.

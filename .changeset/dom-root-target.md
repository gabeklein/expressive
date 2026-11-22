---
"@expressive/dom": patch
---

Styles reach a tree rendered into a shadow root, and a portal into one, through an adopted stylesheet - instead of landing in the document head where they could not apply. Controlled inputs inside a shadow root restore their value.

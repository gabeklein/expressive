---
"@expressive/dom": patch
---

Styles reach a tree rendered into a shadow root, and a portal into one, instead of landing in the document head where they could not apply.

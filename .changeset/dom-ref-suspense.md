---
"@expressive/dom": patch
---

A `ref` in portal content added while its boundary shows a fallback now attaches once revealed, with the element in the document. A ref replaced while hidden no longer receives the element, and is not sent `null` for an element it never got.

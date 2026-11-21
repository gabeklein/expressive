---
"@expressive/dom": patch
---

A `ref` on an element mounted while its boundary shows a fallback is now attached when the content reveals, with the element in the document - it was called early, on the detached element, and not again. A ref replaced before it attaches no longer receives the stale element, and a ref is sent `null` only after it received an element.

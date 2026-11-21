---
'@expressive/dom': patch
---

A callback `ref` or `autofocus` on an element whose child suspends in a transition, as on a client navigation to a page that loads its data, now applies once the element is on the page; it was never applied. Content rendered while a boundary shows its fallback now gets its refs once revealed, not while still detached.

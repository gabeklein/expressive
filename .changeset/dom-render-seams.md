---
"@expressive/dom": patch
---

Importing `@expressive/dom` no longer registers hooks on `Model` or `Component` - rendering installs what it needs. A capitalized method read before the dom module loaded now re-renders with its owner, rather than rendering untracked.

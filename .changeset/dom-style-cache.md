---
"@expressive/dom": patch
---

Re-rendering styled elements reuses resolved rules and class names instead of resolving them again - about a third faster on a styled-list benchmark.

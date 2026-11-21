---
"@expressive/dom": patch
---

Re-rendering styled elements reuses resolved rules and class names instead of resolving them again - a styled list re-renders about a third faster.

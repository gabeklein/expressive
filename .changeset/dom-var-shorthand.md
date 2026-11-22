---
'@expressive/dom': patch
---

A `var()` shorthand followed by one of its longhands in the same rule - `font: \`700 ${$.size}/1 ${$.face}\``, then `fontSize` - no longer loses the shorthand's other parts.

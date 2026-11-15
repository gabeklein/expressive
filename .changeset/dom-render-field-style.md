---
'@expressive/dom': patch
---

A Component whose `render` is a styled function field (`render = Page`) now applies that function's `style()` map, layered over the class's, instead of rendering its elements unstyled.

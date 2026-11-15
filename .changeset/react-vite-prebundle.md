---
'@expressive/react': patch
---

The Vite plugin prebundles `@expressive/mvc` and `@expressive/mvc/hot`, the modules it injects. A cold dev start no longer re-optimizes dependencies partway through the first page load, which could load a second copy of mvc.

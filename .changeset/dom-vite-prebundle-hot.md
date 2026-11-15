---
'@expressive/dom': patch
---

The Vite plugin prebundles `@expressive/mvc/hot`, which it injects, and dom's JSX runtimes, which plugin output such as svgr imports where Vite's scanner can't see it. A cold dev start no longer re-optimizes dependencies partway through the first render, which loaded a second copy of dom and threw `Cannot render [object Object].`

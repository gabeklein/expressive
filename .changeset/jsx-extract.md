---
"@expressive/jsx": minor
"@expressive/dom": patch
---

New package `@expressive/jsx`, the base JSX host: the renderer, the style engine (`style`, `Style`, `Css`), and the JSX runtime. `@expressive/dom` now builds on it as the DOM host, with the same API. A second copy of `@expressive/jsx` in one app is reported with a console error on its first render, `style()` or dom's `renderToString`.

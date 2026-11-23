---
"@expressive/jsx": minor
"@expressive/dom": patch
---

New package `@expressive/jsx`, the base JSX host: the renderer, the style engine (`style`, `Style`, `Css`), the JSX runtime and `renderToString`. `@expressive/dom` now builds on it as the DOM host, with the same API. A second copy of `@expressive/jsx` in one app is reported with a console error on first render or `style()` call.

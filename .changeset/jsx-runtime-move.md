---
"@expressive/mvc": minor
"@expressive/jsx": minor
"@expressive/react": patch
"@expressive/router": patch
"@expressive/inspect": patch
"@expressive/dom": patch
"@expressive/dev": patch
---

The JSX runtime moves from `@expressive/mvc/jsx-runtime` to `@expressive/jsx/jsx-runtime`: `jsx`/`jsxs`/`jsxDEV`, `Fragment`, `host()`, `onElement`, `childrenOf`, `isElement`, `typeOf` and `propsOf`. Portable components set `"jsxImportSource": "@expressive/jsx"` in place of `@expressive/mvc`; `@expressive/mvc/jsx-dev-runtime` is removed. `@expressive/mvc/jsx-runtime` keeps the `Host` manifest and the host seams (`resolver`, `methodOf`, `elements`). Apps on `@expressive/dom`, `@expressive/dev` or `@expressive/react` change nothing.

---
"@expressive/mvc": minor
---

Without a registered host, `@expressive/mvc/jsx-runtime` creates its own element instead of throwing "No JSX host is registered", and `isElement`, `typeOf`, `propsOf` and `childrenOf` read it. `jsxDEV` marks the element with the compiler's `source`. Hosts rendering it use the new `Element` type and `onElement(hook)`, which reports each element as it is created.

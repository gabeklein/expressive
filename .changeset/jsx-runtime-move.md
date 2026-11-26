---
"@expressive/mvc": minor
"@expressive/jsx": minor
"@expressive/react": patch
"@expressive/router": patch
"@expressive/inspect": patch
"@expressive/dom": patch
"@expressive/dev": patch
"@expressive/rpc": patch
---

The JSX runtime moves from `@expressive/mvc/jsx-runtime` to `@expressive/jsx/jsx-runtime`. This covers:
- `jsx`, `jsxs` and `jsxDEV`;
- `Fragment`;
- `host()` and `onElement`;
- `childrenOf`, `isElement`, `typeOf` and `propsOf`;
- the `JSX`, `Element` and `HostRuntime` types.

`@expressive/mvc/jsx-runtime` becomes `@expressive/mvc/host`, keeping only the `Host` manifest and the host seams `resolver`, `methodOf` and `elements` - a custom host renames `declare module '@expressive/mvc/jsx-runtime'` and its imports of `resolver`, `methodOf` and `elements` to `@expressive/mvc/host`. `@expressive/mvc/jsx-dev-runtime` is removed. Portable components set `"jsxImportSource": "@expressive/jsx"` in place of `@expressive/mvc`.

Every copy of `@expressive/jsx` in a realm shares one host registry, so an app that resolves two copies still has one host - and so do separately bundled apps on one page or in one process; a React app beside a dom app is not supported, and dom reports the foreign elements. A host that registers with the same `jsx` replaces its members; another `jsx` throws.

Without a registered host, the runtime creates its own element instead of throwing "No JSX host is registered", and the introspection functions read it. `jsxDEV` marks the element with the compiler's `source`, and `onElement(hook)` reports each element as it is created.

DOM element typing - intrinsics, events, `style`, and Model props through `LibraryManagedAttributes` - now comes from `@expressive/dom/jsx-runtime`. Apps on `@expressive/dom`, `@expressive/dev` or `@expressive/react` change nothing.

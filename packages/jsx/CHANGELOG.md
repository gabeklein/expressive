# @expressive/jsx

## 0.1.0

### Minor Changes

- [#849](https://github.com/gabeklein/expressive/pull/849) [`5d717d2`](https://github.com/gabeklein/expressive/commit/5d717d2850a5527e15ee58770f3a526b1e5500a9) `<Component for={instance}>` renders a provided Component instance around its children. New children re-render it without replacing its construction props or resetting its fields. The element's `fallback` and `catch` cover the placed render.

  Host authors can read the provider's children through `placement(instance)` from `@expressive/mvc/host`; it returns `undefined` when the instance is not placed.

- [#845](https://github.com/gabeklein/expressive/pull/845) [`54b60e9`](https://github.com/gabeklein/expressive/commit/54b60e923a827e31b34f88013f0ce05280a2314f) New package `@expressive/jsx`, the base JSX host: the renderer, the style engine (`style`, `Style`, `Css`), and the JSX runtime. `@expressive/dom` now builds on it as the DOM host, with the same API. A second copy of `@expressive/jsx` in one app is reported with a console error on its first render, `style()` or dom's `renderToString`.

- [#845](https://github.com/gabeklein/expressive/pull/845) [`54b60e9`](https://github.com/gabeklein/expressive/commit/54b60e923a827e31b34f88013f0ce05280a2314f) The JSX runtime moves from `@expressive/mvc/jsx-runtime` to `@expressive/jsx/jsx-runtime`. This covers:
  - `jsx`, `jsxs` and `jsxDEV`;
  - `Fragment`;
  - `host()` and `onElement`;
  - `childrenOf`, `isElement`, `typeOf` and `propsOf`;
  - the `JSX`, `Element` and `HostRuntime` types.

  `@expressive/mvc/jsx-runtime` becomes `@expressive/mvc/host`, keeping only the `Host` manifest and the host seams `resolver`, `methodOf` and `elements` - a custom host renames `declare module '@expressive/mvc/jsx-runtime'` and its imports of `resolver`, `methodOf` and `elements` to `@expressive/mvc/host`. `@expressive/mvc/jsx-dev-runtime` is removed. Portable components set `"jsxImportSource": "@expressive/jsx"` in place of `@expressive/mvc`.

  Every copy of `@expressive/jsx` in a realm shares one host registry, so an app that resolves two copies still has one host - and so do separately bundled apps on one page or in one process; a React app beside a dom app is not supported, and dom reports the foreign elements. A host that registers with the same `jsx` replaces its members; another `jsx` throws.

  Without a registered host, the runtime creates its own element instead of throwing "No JSX host is registered", and the introspection functions read it. `jsxDEV` marks the element with the compiler's `source`, and `onElement(hook)` reports each element as it is created.

  DOM element typing - intrinsics, events, `style`, and Model props through `LibraryManagedAttributes` - now comes from `@expressive/dom/jsx-runtime`. Apps on `@expressive/dom`, `@expressive/dev` or `@expressive/react` change nothing.

### Patch Changes

- [#855](https://github.com/gabeklein/expressive/pull/855) [`1b9ca5e`](https://github.com/gabeklein/expressive/commit/1b9ca5e831c2e22f9f848a4d4840957640bf92de) A `Redirect` thrown while rendering during a pushed in-app navigation keeps the current screen until its target is ready, instead of flashing the Route `fallback` - on `@expressive/dom` and on React 18+ with a concurrent root. Preact, older React, cold loads and replacing navigations still show the fallback. A `Redirect` from a second copy of the router is now recognized too.
- Updated dependencies [[`5d717d2`](https://github.com/gabeklein/expressive/commit/5d717d2850a5527e15ee58770f3a526b1e5500a9), [`54b60e9`](https://github.com/gabeklein/expressive/commit/54b60e923a827e31b34f88013f0ce05280a2314f), [`bd33e34`](https://github.com/gabeklein/expressive/commit/bd33e34af218dee798dcbca862b1ee8f21754393), [`54b60e9`](https://github.com/gabeklein/expressive/commit/54b60e923a827e31b34f88013f0ce05280a2314f), [`1afeb40`](https://github.com/gabeklein/expressive/commit/1afeb40298921c57a3990a31e6ebdae5630fc152), [`3600c49`](https://github.com/gabeklein/expressive/commit/3600c493cffab48675bc6dbb4d47070a261e9942)]:
  - @expressive/mvc@0.98.0

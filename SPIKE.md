# Spike: dom's style engine on @expressive/react

Branch `spike/react-style`, not for merge. Probes live in `packages/react/src/style.test.tsx`.

## Mechanism

- `jsxImportSource: "@expressive/react"` - the runtime stamps the rendering component (author) into props under a symbol, and hosts function, `memo`, `forwardRef` and `lazy` types at creation.
- Each hosted render's output is walked before React sees it: host elements resolve `_rule`/`style` to `className` + `style`; component elements get their appearance through a WeakMap keyed by their props object. Untouched elements are returned as is.
- Server (no `window`): rules collect in a process-wide sink; each host emits `<style href precedence>` tags for the classes it used.

## Works (tested)

Rules, base declarations, `:hover`/`@media`, pack macros, `$` variables, caller rules on child roots, `style` forwarding, children keeping their author's rules, descendant scopes across component boundaries, `_Title` subcomponents, elements memoized across renders, `Children.map`/`toArray`, `cloneElement`, portals, Suspense fallbacks, `memo`/`forwardRef`/`lazy`, StrictMode, suspend-then-resolve, class `hot.accept` with new maps, react-refresh state-preserving swaps (with plugin cooperation), `renderToString`, streamed documents (hoisted to head), late Suspense boundaries, hydration without mismatch, pack variables and macros on the server.

## Limitations to document

- **JSX runtime required.** Elements built with React's own runtime are not author-stamped and their function components are not hosted: `_rule` still resolves on host elements in a hosted render, but their output and passed-in children fall back to the placing component's scope.
- **Element type identity.** Function, `memo`, `forwardRef` and `lazy` types are replaced by hosts - `child.type === Button` fails. Compare a marker instead.
- **Render props** resolve against the component that calls them, not the one that wrote them. Same in dom.
- **Third-party components** (anything rendered by another library's JSX) are not walked: their output stays unresolved, and a caller `_rule` reaches them as a token array in `style` - spread onto a DOM element it breaks. Needs a `className` handoff at that boundary.
- **memo** never bails out while a caller `_rule` targets it - the resolved token is new each render.
- **Reused elements** keep the appearance from their last walk; a change in the placing scope without a new element does not restyle them.
- **Class names** of `memo`/`forwardRef` need `displayName`, else `style_*`.
- **Fast refresh** needs the bundler plugin to register each host beside its component (`refresh()`), and forward its `$RefreshSig$` signature - without the signature, a hooks edit throws instead of remounting. Not yet wired into `@expressive/react/vite`.
- **SSR ordering.** React orders precedence groups by first sight. Depth-ordered groups (`expressive-0..3`, led by placeholders) keep caller rules after callee bases; ordinal order within one depth follows discovery and can invert in rare cross-component cases. Groups interleave with app `precedence` groups by first sight.
- **SSR class names** must match the client: name collisions (two components with one name) suffix in emission order, which can differ between server and client and mismatch hydration.
- **Server Components.** `@expressive/react` itself does not load under `react-server` (on `main` too): React's server build has no `Component` to extend. The style host does, with hooks made optional - styled plain server components render through Flight with class names, caller rules across server components and precedence styles. Caller rules and author stamps do not survive a `'use client'` boundary (identity tokens and a symbol key; Flight serializes neither) - inferred, not tested. Probe scripts: scratchpad `rsc/`.
- **Runtime cost** - see Performance.
- Real-browser results: see Browser proof.

## Dealbreakers

None found. Each leak above either has a fix in the spike or is a documentable edge. The two that bite a Tailwind pitch hardest are third-party component interop and runtime cost.

## Extraction from dom

- As is: `style/{protocol,claim,stylesheet,appearance,css,declarations,root,numeric,diagnose}` (`applyClaim` stays dom-only).
- Host layer: `core/appearance.ts` - parametrize author lookup, subcomponent owner and hot `latest`.
- Move from `server.ts` into style: `UNITLESS`, `kebab`, `text` - a server sink for any host.
- Expose for hosts: `serving`, `sinking`, `attachRoots`, the sink's insert index.

## Performance

Re-render of a 6k-element styled list, median, happy-dom:

| | plain | styled | styled + engine cache |
|---|---|---|---|
| dom | 8.3ms | 14.3ms | 9.8ms |
| react | 13.4ms | 23.7ms | 18.1ms |

Profiles put the cost in the per-element resolve chain (`resolveAppearance`, `createAppearanceRoute`, `createAppearanceToken`, `claim`), identical in both hosts. Commit `dbbf29497` caches it in the engine - resolved appearance per route and flag mask, one token per resolved appearance, bare claims per target and stylesheet generation. dom suite, cascade probe and hot probe pass. It stands alone as a dom PR.

Left after caching: dom - route key building (~6% of profile), dev-only `unmatched` diagnostics (~4.5%); react - the walk and element clones (~10%). The plain column is the floor a compiler can reach - react's plain run is walked too.

## Vite plugin options

Ordered by payoff per effort:

1. **Call-site route ids.** JSX knows its `_` attributes statically; the plugin passes a precomputed route id so the engine skips scanning props, and runs typo diagnostics at build time (dev warnings become compile errors, zero runtime). Small, host-agnostic.
2. **Extracted CSS.** Evaluate `style()` maps at build (module runner, as vanilla-extract and wyw-in-js/Linaria do), emit a static stylesheet: HTTP-cacheable, no first-render expansion or `insertRule`, SSR needs no sink, CSP-friendly. Runtime keeps class names; HMR invalidates per module.
3. **className folding.** Where an element's scope is static within one render - not a root, not inside `{children}`, no spread carrying `_` keys - compile `_row _odd={x}` to `className={x ? 'A B' : 'A'}` (StyleX's approach). Roots and passed-in children keep the runtime path. Reaches the plain column for most elements; needs 2.
4. **React Compiler pairing.** Memoized JSX gives stable elements; with a stable `renderedAppearance`, the walk can cache clones per element and skip unchanged subtrees. React-only.

## Browser proof

`bun .github/scripts/react-style-probe.ts` - headless Chrome over a Vite 8 dev server (`@vitejs/plugin-react` 5.2, `jsxImportSource: "@expressive/react"`, React 19.2, StrictMode on the client root, workspace sources aliased as hot-probe does). Fixture: `.github/scripts/react-style-probe/`, copied to the gitignored `.react-style-probe/` so edits stay out of the tree. Every assertion reads `getComputedStyle`; the class string is logged as evidence. Same `CHROME` rules as the other probes. Result: **66/68 pass**, plus 3 known limitations reproduced.

### Client render - all pass

Own rules + base (`Own_note Own`), `_on` flag toggled by state on a class Component, caller `_accent` on `<Button>` beating its base (`Toolbar_accent-d1 Button` red, sibling `Button` blue, callee inline `letterSpacing` kept), lexical nesting through two function boundaries and `{children}` (`Lexical_ul_item`), through a class Component's `props.children`, a nested rule on a wrapper element reaching passed-in children (`_frame: { _item }`), descendant scope not reaching another component's own `_item`, `memo` (own rule, caller rule, passed-in children) and `forwardRef` (own, caller, ref delivered), portal, Suspense fallback, `lazy`. No `_` attribute reaches the DOM; console clean.

A component compiled with React's own JSX runtime but *placed* by styled code is hosted anyway - wrapping happens at the creation site - so its spread `<div {...props}>` resolves: caller rules and authored children both pass.

### SSR + hydration

| | before hydration (JS off) | hydration | after hydration |
|---|---|---|---|
| `renderToReadableStream` document | pass | pass - no mismatch, no recoverable error, identical class names | pass, incl. new client-only rules |
| `renderToString` into `#root` | pass | pass (one recoverable error from `renderToString` aborting a Suspense boundary - React's, not ours) | **2 fail** |

Caller rendered before callee (`<Toolbar>` with `<Button _accent>` first, a standalone `<Button>` after): server tags come out `expressive-0: Button … / expressive-1: Toolbar_accent-d1`, and the caller wins in both phases on both routes. Late Suspense boundary on the stream: styled before and after hydration.

**Failed:** `/ssr-string` after hydration - (1) a flag whose rule the server never emitted (`Toggle_on`) toggles its class but stays gray, (2) a client-only caller rule (`Reveal_late-d1`) loses to the server-emitted callee base. Cause: in a non-document render React leaves the precedence `<style>` tags inline in `#root`; dom's client sheet is appended to `<head>`, so it precedes them and every equal-specificity server rule wins. Evidence: `head:sheet(11 rules) body:expressive-0[9] body:expressive-1[2] …`. Moving `#root > style[data-precedence]` into `<head>` before `hydrateRoot` (`/ssr-string?hoist`) makes both pass. Fix belongs in the host: open the client sheet after the last `expressive-*` group, or relocate those tags before hydrating - needs a placement hook on dom's `open()` (host-layer parametrization, as listed under Extraction). The stream route passes only because its tags hoist into `<head>` before the sheet exists.

Also seen: the client sheet re-inserts every rule the server already sent (11 duplicates on this page) - harmless for cascade, wasted work on first render.

### Fast refresh

- Wired component - `refresh(Counter, id, register)` plus a hand-written signature on `wrap(Counter)` through `createSignatureFunctionForTransform()` (plugin-react's runtime has no `setSignature` export) - **pass**: rule + text edit keeps state (`v2 3`, blue, no reload); a hooks edit with the signature key changed remounts cleanly (`v3 0 0`).
- The id must be stable: `import.meta.url` carries `?t=` after the first update, which silently registers a new family and drops the edit.
- Class Component map edit through `hot.accept`: pass.
- [limitation, reproduced] unwired function component: the edit never shows (`v1 2`, old color) - refresh updates the original's family, but the fiber's type is the wrapper.
- [limitation, reproduced] hooks edit without updating the wrapper signature: React "change in the order of Hooks", the tree unmounts.

### Console warnings

None from hosted output. One reproduced limitation: a third-party component that forwards props to an inner component built with React's runtime (`ThirdDeep -> Leaf`). Function components receive the caller's `_accent` in their props, so the unhosted leaf spreads it: React warns `Received true for a non-boolean attribute _accent`, then the token array in `style` throws `Failed to set an indexed property [0] on 'CSSStyleDeclaration'` and unmounts the root. Matches "Third-party components" above, but it is a crash, not unstyled output.

### New limitation: duplicate engine under Vite pre-bundling

`@vitejs/plugin-react` force-adds `<jsxImportSource>/jsx-dev-runtime` to `optimizeDeps.include`. When `@expressive/react` itself is not pre-bundled (linked workspace package, or `exclude`), the runtime gets its own copy of the style engine: `style()` registers in one, `wrap()` reads the other, and every function component renders unstyled - silently, no warning. Class Components still work (hosted through the adapter, same copy). The probe strips `@expressive/*` from `include` in `configResolved`. `@expressive/react/vite` must do the same, or force both into one pre-bundle. With a real install both are pre-bundled together and share a chunk - not probed.

### Dealbreakers

None. The renderToString sheet order is a placement bug with a proven workaround; the duplicate-engine trap and refresh wiring are plugin work already on the list.

### Not covered

Production build (all runs are Vite dev), an installed `dist` package, React Server Components in a browser, `:hover`/`@media` in Chrome (only happy-dom).

## Step 1: on @expressive/jsx

Branch `spike/react-style-jsx`, cut from `feat/jsx` (#845). The host no longer reaches into dom.

- **From /jsx's public root:** nothing yet at runtime - see the type note below.
- **Reused from the jsx core, imported by path** through `packages/react/src/jsx-internals.{js,d.ts}`: `styleElement` (element step - rules, `_` checks, claim, children's appearance), `componentProps`, `observe`, `consume` (props `style` tracking), `renderedAppearance`, `enterAppearance`, `style`/`Style`/`Css`.
- **Still React's own:** author stamping (props symbol - React elements are not vnodes, so jsx's `onElement` author map never sees them), `authored` over that stamp, subcomponent appearance (React renders `this.Title` through a wrapper `methodOf` cannot see), the element walk, wrapping exotic types, and the `Styles` for document and the server sink with precedence tags.
- `Styles` replaces `serving`/`sinking`/`attachRoots`: the engine takes the target per call, so the server sink is a plain `Styles` and no global switches between them.
- **Type note:** importing `@expressive/jsx`'s root from React source pulls `render/component.ts` into React's typecheck, where React's `Host` augmentation breaks jsx's `Node` types. Published `.d.ts` would not check implementation, so this is a monorepo source-path artifact; the shim's `.d.ts` side-steps it.

Results: react, jsx, dom and router suites pass (61 files, 1442 tests); style tests 30/30; Chrome probe unchanged at **66/68** - the same two `renderToString` post-hydration failures, the same 3 limitations reproduced.

### /jsx surface (approved, added)

Exported from `@expressive/jsx`'s root, with JSDoc and an `expressive-jsx` skill entry:

- `placeComponent(type, props, appearance)` - the core's `componentProps`, renamed. It does not wrap `props.style`: React copies props when it creates an element, so a getter set at placement would be read and lost.
- `renderComponent(record, render)` - wraps `record.props` so a `style` read is noticed (idempotent, so the core's already-wrapped props pass through), runs the render under tracking, returns `{ output, appearance }`. The core's render pass uses it.
- `authorAppearance(author, appearance)` - the core's `authored` with the author passed in; `authored` now delegates to it.
- `Rendered.method` - a subcomponent's owner and key when its type is a host wrapper; the core's `renderedAppearance` reads it before `methodOf`.

React now imports only these plus `styleElement`, `style`, `Style` and `Css`, all public; its `authored` copy and subcomponent appearance are gone. `jsx-internals.{js,d.ts}` remains only as the type barrier described above.

Results: jsx suite and coverage gates pass (new host-steps test); react, jsx, dom and router suites pass (1443 tests); `example-check` and `docs-check` pass after a build; Chrome probe unchanged at **66/68**.

## Step 2: client sheet placement, no render

Tried first: `render`/`hydrate` on a new `@expressive/react/dom` subpath (commits `aeeb14018`, `efb040894`, reverted). It worked - 66/66 in Chrome - but its only jobs were picking a root's style target and moving the server's style groups before hydrating, and neither needs `react-dom`. Dropped in favor of zero new surface.

Now: the host's document sheet, on opening, looks for server `expressive-*` precedence groups. If the last one is outside `<head>` - `renderToString` into a container leaves them inline there - the sheet goes at the end of `<body>`: after the groups, outside a `#root` container React hydrates. Otherwise it goes at the end of `<head>` as before.

- Plain `createRoot`/`hydrateRoot` work; `@expressive/react` adds no export and no `react-dom` dependency.
- Results: style tests 31/31 (new placement test with plain `hydrateRoot`, failing without the change); react, jsx, dom and router suites pass (1444 tests); Chrome probe **52/52**, 3 limitations reproduced - both `/ssr-string` post-hydration failures fixed.
- Not covered: a non-document `renderToString` hydrated with the container being `<body>` itself (the sheet would land inside React's container), and server groups that first appear after the sheet opened (a second root hydrated later) - the sheet does not move.
- Shadow roots: no way to target one now. A `react`-only provider component would add it if wanted.
- `@expressive/react` publishes no `./jsx-runtime` subpath on this trunk; landing styled JSX needs `./jsx-runtime` and `./jsx-dev-runtime` exports.

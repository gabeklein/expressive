# feat/jsx - the base host

Trunk for extracting `@expressive/jsx` from `@expressive/dom` and giving every host the same root-owned contract. Feature PRs target this branch. It lands on `main` as a rebase merge once release-ready. This file does not land on `main`.

## Scope

- **A root-owned host contract.** `render`/`renderToString` own all configuration; nothing is installed on import and nothing is global.
- **`@expressive/jsx`** is the base other hosts build on: vnodes and the reconciler with its host seam, plus the style engine. dom becomes the DOM host on top of it: element patching, hydration, portal targets, `renderToString`, focus and DOM style writing.
- **React** keeps registering `host()` as the element-factory override. Its styling through a required `render` comes after the extraction.

## Decided

- **/jsx ships the runtime; hosts keep the import source.** /jsx owns `jsx`, `Fragment` and the host registry, typed host-neutral. Apps keep `jsxImportSource` on their host (`@expressive/dom`, `@expressive/dev`), which re-exports the runtime with its element types. Portable code (router, component libraries) sets `@expressive/jsx`. /jsx is a vendor package, not app configuration.
- **mvc is the shared host-seam layer, not the runtime, and knows as little about JSX as possible.** It keeps only what hosts must share: the default element and its brand, `onElement`, `resolver` and `methodOf`.
- **No style store in mvc.** Style registration stays inside /jsx's style engine. A duplicate /jsx is an edge case that /jsx reports loudly at load, not one it makes interoperate.
- **/jsx is a regular dependency of hosts, never a peer.**
- **A render root is `{ host, container, target? }`.** A `Host` creates text, markers and fragments and mounts/patches/unmounts intrinsics. Its nodes keep a DOM-shaped structural contract.
  - `dom` is the full host.
  - `plain` is what /jsx does with no host opinion: tags as written, props as attributes, `on*` handlers attached.
  - Optional host seams: `hydration` (adopt existing markup, keep and resume suspended ranges; without it `hydrate` renders), `locate` (string `Portal` targets; without it targets must be nodes), `portaled` (after a portal mounts), `hoist`, and `target`/`styles`.
- **/jsx has one export surface, its root.** It's a vendor package for hosts, so it exports internals freely, with no `./host` or `./server` subpaths. dom stays the curated surface.
- **`Context.root` is shared across hosts on purpose.** Root-held globals keep a human UI and an agent interface in sync. Releasing a root pops only its own child context.
- **Host hooks act only during their own host's render.** Several hosts can share a process, e.g. dom plus a headless JSON/agent host.
- **CI's Chrome stays unpinned**, so browser regressions surface. The number-table check stays non-blocking.

- **One walker.** `renderToString` renders through the reconciler: `settled()` waits out suspense instead of drawing fallbacks, and dom serializes a string-tree host. A `catch` retry that gets no further escalates outward, so a server render ends.
- **/jsx stays thin: vnodes for hosts, and generic style.** Framework-host concerns live in dom: `renderToString` and HTML semantics, hydration, DOM portal targets, focus.
- **CSS tentatively belongs to dom.** That covers `Css`, units, property types and emission. React may duplicate what it needs, or reuse React's own CSS handling. A separate `/css` package (maybe with a runtime or a Vite extraction plugin) is the fallback, not the plan. It isn't first in line.
- **The core styles elements and reconciles their children.** With `styles` on the root, the core runs `styleElement` (rule lookup, `_` diagnostics, the claim, the children's appearance) before `Host.patch`, which applies `fiber.claimed`. The core then reconciles children unless `patch` returns `false`, and calls the optional `settle` after them. `styleElement` is exported so the React adapter styles elements with the same step while React reconciles its own children. Chosen over hosts reconciling children with `fiber.inner`, where forgetting the appearance silently drops author-scoped styles.

## In this trunk

- #797 mvc `methodOf` - subcomponent owners found at call time.
- #798 dom installs nothing on import.
- #800 mvc default element and `onElement`; dom registers no host; per-element dev marks.
- #801 one tag table; nodes from the root's document (fixes iframes).
- #802 one `Styles` facility for document, shadow root and server sink.
- #803 render through a `Host` (dom, `plain`, custom-host tests).
- #805 extraction step 1: `@expressive/jsx` package; dom is its DOM host; duplicate copies reported.
- #806 `renderToString` through the reconciler: jsx `settled()`, dom's string-tree host; the second walker is gone.
- Runtime move: /jsx owns the JSX runtime and host registry; mvc's host subpath keeps the `Host` manifest, `resolver`, `methodOf`, `elements`. DOM element types live in dom. Apps keep `jsxImportSource` on their host (`@expressive/dom`, `@expressive/dev`); portable code (router, libraries) uses `@expressive/jsx`.
- Test split: jsx and dom run only their own suites; DOM-only behaviours (selector portals, head hoisting, SVG, refs, autofocus, style targets) moved to dom; jsx covers `settled()` and its seams on `plain`.
- jsx's suite without dom: style tests render through a stylesheet test host, JSX compiles against jsx's runtime with test-only intrinsics; the jsx→dom edge in `affected.ts` is gone.
- Unused root exports dropped: `mountRoot`, `rootOf` and the root `JSX` type (`JSX` stays on `/jsx-runtime`).
- The core resolves element styling (`styleElement`), assigns `fiber.props` and reconciles element children; `Host.patch` applies the claim and may return `false`; `Host.settle` runs after children with the last settled props. `claim`, `unmatched`, `reserved` and `reconcileChildren` leave the root export.
- mvc's `./jsx-runtime` subpath is renamed `./host` - it holds no runtime, only the seams hosts share. A custom host augments `declare module '@expressive/mvc/host'`.
- `Host.mount` creates or adopts its node and returns it; the core sets the fiber's range and runs `patch` inside `complete`; `complete` is no longer exported.

## Before release

- **A /jsx skill** (`packages/jsx/skills/`) once its public shape settles.
- **Public API**, iterated once the first extraction exists:
  - trimming /jsx's root export to what hosts actually use;
  - the `Host` type;
  - `render(node, el, options)`, with options as partial `Host` overrides over `plain`.
- **Fat cutting, after the extraction:**
  - `Fiber.root` required;
  - revisit `methodOf`/`onElement` once the runtime entry is mandatory.
- **npm trusted publishing** for `@expressive/jsx`, set before its first release.

## Open questions

- **`_` props without `styles`.** `styleElement` runs only when the root has `styles`, so on `plain` a `_flag` is an ordinary prop (written as an attribute) and `_Name` doesn't throw. Should a style-less host still reject reserved keys?
- **`settle` has one user.** dom needs it for controlled `value`/`checked` after `<option>`s exist, and for refs. If no other host ever does, it could fold back into a dom-only path.
- **Props across a suspended pass.** The core assigns `fiber.props` as soon as `patch` returns, so a retry after children suspend diffs against what was applied. `settle` instead gets the props of the last pass that reached it, since a suspended pass skips it - one more field (`Fiber.settled`) to keep that. Is a second props snapshot the right price for `settle`?
- **`patch` returning `false`** leaves previously reconciled children mounted; the host unmounts them, as dom does before `innerHTML`. Could the core do it without fighting the host's own content write?
- **React adoption.** `spike/react-style` imports style internals by path. Moving it onto `styleElement` from `@expressive/jsx` is part of React styling, after this trunk.
- **Non-DOM hosts** (terminal, three) must present DOM-shaped nodes, and a host embedded in another host's tree inherits no context or boundaries - board items "jsx: a root nested in another host's tree inherits nothing" and "One JSX host per build, at runtime and at type level".

Tracking: board items "/jsx: extract the base host", "dom: root-owned host contract", "Reevaluate host-contract stopgaps".

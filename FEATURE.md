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

## In this trunk

- #797 mvc `methodOf` - subcomponent owners found at call time.
- #798 dom installs nothing on import.
- #800 mvc default element and `onElement`; dom registers no host; per-element dev marks.
- #801 one tag table; nodes from the root's document (fixes iframes).
- #802 one `Styles` facility for document, shadow root and server sink.
- #803 render through a `Host` (dom, `plain`, custom-host tests).
- #805 extraction step 1: `@expressive/jsx` package; dom is its DOM host; duplicate copies reported.
- #806 `renderToString` through the reconciler: jsx `settled()`, dom's string-tree host; the second walker is gone.
- Runtime move: /jsx owns the JSX runtime and host registry; mvc's `jsx-runtime` keeps the `Host` manifest, `resolver`, `methodOf`, `elements`. DOM element types live in dom. Apps keep `jsxImportSource` on their host (`@expressive/dom`, `@expressive/dev`); portable code (router, libraries) uses `@expressive/jsx`.
- Test split: jsx and dom run only their own suites; DOM-only behaviours (selector portals, head hoisting, SVG, refs, autofocus, style targets) moved to dom; jsx covers `settled()` and its seams on `plain`.
- jsx's suite without dom: style tests render through a stylesheet test host, JSX compiles against jsx's runtime with test-only intrinsics; the jsx→dom edge in `affected.ts` is gone.
- Unused root exports dropped: `mountRoot`, `rootOf`, `within` and the root `JSX` type (`JSX` stays on `/jsx-runtime`).

## Before release

- **A /jsx skill** (`packages/jsx/skills/`) once its public shape settles.
- **Public API**, iterated once the first extraction exists:
  - trimming /jsx's root export to what hosts actually use;
  - the `Host` type;
  - `render(node, el, options)`, with options as partial `Host` overrides over `plain`.
  - The `Host` hands the core a `Styles` receiver, and the core resolves element styles for any host that has one.
- **Fat cutting, after the extraction:**
  - `Fiber.root` required;
  - the host returns its node while the core does the fiber bookkeeping;
  - revisit `methodOf`/`onElement` once the runtime entry is mandatory.
- **npm trusted publishing** for `@expressive/jsx`, set before its first release.

Tracking: board items "/jsx: extract the base host", "dom: root-owned host contract", "Reevaluate host-contract stopgaps".

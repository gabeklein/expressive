# feat/jsx - the base host

Trunk for extracting `@expressive/jsx` from `@expressive/dom` and giving every host the same root-owned contract. Feature PRs target this branch. It lands on `main` as a rebase merge once release-ready. This file does not land on `main`.

## Scope

- **A root-owned host contract.** `render`/`renderToString` own all configuration; nothing is installed on import and nothing is global.
- **`@expressive/jsx`** holds the base host: the renderer (vnode, reconciler, host seam), the style engine, and `renderToString`. dom becomes DOM node operations, hydration and DOM-only APIs on top of it.
- **React** keeps registering `host()` as the element-factory override. Its styling through a required `render` comes after the extraction.

## Decided

- **/jsx ships the runtime.** Users set `jsxImportSource: @expressive/jsx`. Moving dom users off `@expressive/dom` is a breaking change (`minor` pre-1.0); `dom/jsx-runtime` stays as a re-export for a release.
- **mvc is the shared host-seam layer, not the runtime, and knows as little about JSX as possible.** It keeps only what hosts must share: the default element and its brand, `onElement`, `resolver` and `methodOf`.
- **No style store in mvc.** Style registration stays inside /jsx's style engine. A duplicate /jsx is an edge case that /jsx reports loudly at load, not one it makes interoperate.
- **/jsx is a regular dependency of hosts, never a peer.**
- **A render root is `{ host, container, target? }`.** A `Host` creates text, markers and fragments and mounts/patches/unmounts intrinsics. Its nodes keep a DOM-shaped structural contract.
  - `dom` is the full host.
  - `limp` is what /jsx does with no host opinion: tags as written, props as attributes, `on*` handlers attached.
- **`Context.root` is shared across hosts on purpose.** Root-held globals keep a human UI and an agent interface in sync. Releasing a root pops only its own child context.
- **Host hooks act only during their own host's render.** Several hosts can share a process, e.g. dom plus a headless JSON/agent host.
- **CI's Chrome stays unpinned**, so browser regressions surface. The number-table check stays non-blocking.

## In this trunk

- #797 mvc `methodOf` - subcomponent owners found at call time.
- #798 dom installs nothing on import.
- #800 mvc default element and `onElement`; dom registers no host; per-element dev marks.
- #801 one tag table; nodes from the root's document (fixes iframes).
- #802 one `Styles` facility for document, shadow root and server sink.
- #803 render through a `Host` (dom, limp, custom-host tests).
- #805 extraction step 1: `@expressive/jsx` package; dom is its DOM host; duplicate copies reported.

## Before release

- **Move users to `jsxImportSource: @expressive/jsx`.** dom's Vite plugin (`RUNTIMES`, `RENDERER`) and dev's plugin (`DEPS`, `SHARED`, `optimizeDeps`) know only `@expressive/dom`'s runtime ids today, so they need /jsx's added.
- **Refactor the moved tests** onto limp and custom hosts. Then drop the doubled vitest includes in jsx and dom and the temporary jsx→dom edge in `affected.ts`.
- **A /jsx skill** (`packages/jsx/skills/`) once its public shape settles.
- **Public API**, iterated once the first extraction exists:
  - /jsx's exports: root `style`/`Css`, plus the renderer and style-engine subpaths;
  - the `Host` type;
  - `render(node, el, options)`, with options as partial `Host` overrides over limp.
  - The `Host` hands the core a `Styles` receiver, and the core resolves element styles for any host that has one.
- **Fat cutting, after the extraction:**
  - autofocus handling out of the reconciler;
  - `Fiber.root` required;
  - the host returns its node while the core does the fiber bookkeeping;
  - revisit `methodOf`/`onElement` once the runtime entry is mandatory.
- **npm trusted publishing** for `@expressive/jsx`, set before its first release.

Tracking: board items "/jsx: extract the base host", "dom: root-owned host contract", "Reevaluate host-contract stopgaps".

---
name: expressive-jsx
description: The base JSX host (@expressive/jsx) - the reconciler, style engine and JSX runtime other hosts build on. Use when writing a host for a new platform (terminal, canvas, native, a test renderer), when a library must render under any host, or when wiring element styling into another reconciler. Apps render through a host package instead - expressive-dom.
---

# @expressive/jsx

The renderer core: vnodes, the reconciler, the style engine (`style`, `Style`, `Css`) and the JSX runtime. A host supplies the platform - nodes, props, styles - and gets components, Models, suspense, boundaries, portals, transitions and hot reload from the core.

Apps never import it - `@expressive/dom` (and `@expressive/dev` on top of it) is the host an app uses. A host depends on `@expressive/jsx` as a regular dependency, never a peer. Pre-1.0: the host contract below may change between minors.

## Portable components

A library meant for any host compiles against jsx's runtime:

```jsonc
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "@expressive/jsx" } }
```

Its elements are host-neutral and render under whichever host renders the tree. Built alone it has no intrinsic tags - `IntrinsicElements` comes from the host the app installs (see [Typing a host](#typing-a-host)) - so it renders Components and tags typed by its own consumers.

Depend on `@expressive/jsx` with a range the app's host also satisfies, so one copy installs. A second copy logs an error at first render: each copy renders and styles on its own, and a `PORTAL` from one isn't recognized by the other.

## Rendering through a host

```tsx
import { hydrate, plain, render, settled } from '@expressive/jsx';

const release = render(<App />, container, plain);
```

- `render(node, container, host)` replaces the container's content and returns the unmount.
- `hydrate(node, container, host)` adopts existing markup through `host.hydration`; without it, renders.
- `settled(node, container, host, signal?)` resolves once nothing is suspended - no fallbacks drawn. The base of server rendering.
- `plain` is the opinion-free host: tags as written, props as attributes, `on*` handlers attached. No styles, selector portal targets or hydration. Override parts with a spread - `{ ...plain, hoist }`.

Several roots, each with its own host, can render in one process. A root renders into its container and the targets of its portals - a host embedded in another host's tree inherits no context, boundaries or suspense.

## Writing a host

`Host`, `Hydration`, `Root`, `Fiber`, `Styles` and `Claim` are type exports.

```ts
const scene: Host = {
  text: (root, value) => new TextItem(value) as never,
  marker: (root, kind) => new Marker(kind) as never,
  fragment: () => new Group() as never,
  mount: (fiber, value, parent, before) => parent.insertBefore(new Item(value.type as string) as never, before),
  patch(fiber, value) {
    const { children, key, ...props } = value.props;
    (fiber.start as unknown as Item).set(props, fiber.props);
  },
  unmount(fiber) {}
};
```

`value.props` includes `children` and `key` - the core handles both, so `patch` skips them.

Nodes must be DOM-shaped: the core walks `parentNode`/`nextSibling`, writes a text node's `nodeValue`, empties a container with `replaceChildren()`, and moves nodes with `insertBefore`, `appendChild`, `prepend`, `append` and `remove`. Inserting a fragment moves its children. `getRootNode()` returns the topmost ancestor - a detached fragment's own node, so commits for content built off-page wait until it attaches. `Host` is typed in DOM nodes: a non-DOM platform wraps its objects to fit, needs lib `dom` and casts at the seam.

| Member | Role |
|---|---|
| `text`, `marker`, `fragment` | Create a text node, a range marker, a fragment |
| `mount(fiber, value, parent, before)` | Create (or adopt) an intrinsic element's node, insert it, return it. Set no props here - a throw in `mount` is not parked |
| `patch(fiber, value, previous?)` | Write props. `fiber.props` holds what was last applied. Return `false` when the host set the content itself |
| `settle?(fiber, value, previous)` | After children - props that need them, as a `<select>`'s `value` |
| `unmount(fiber)` | Release what `mount`/`patch` attached - per element, children first; the core removes the node |
| `target?`, `styles?` | Turn on styling - see [Styles](#styles) |
| `hydration?` | Adopt existing markup - see [Hydration](#hydration) |
| `locate?(into, parent)` | Resolve a string `Portal` target; without it targets must be nodes |
| `portaled?(fiber, adopted)` | Called once a portal and its children mount |
| `hoist?(value, parent)` | Redirect a child before it mounts, as dom sends `<title>` to the head |

### One element pass

1. `mount` returns the node; the core sets the fiber's range to it.
2. With `styles`, the core styles the element and sets `fiber.claimed`.
3. `patch` writes props against `fiber.props`; the core then assigns the new props.
4. The core reconciles `value.props.children` into the node - unless `patch` returned `false`.
5. `settle` runs, getting the props of the last pass that reached it.

Children that suspend during step 4 end the pass there, and the element is patched again when they resolve. `patch` diffs against what it applied; `settle` catches up from the last props it saw.

Returning `false` leaves earlier-reconciled children mounted - unmount them first (`unmountFiber` each, then empty `fiber.children`).

### Fiber

Read `start` (the node), `props`, `claimed`, `root`, `children`, `dead`, and `portalContainer` for a portal. Keep host state in a map keyed by fiber.

### Helpers

- `inserted(fiber, run)` - once the fiber is on the page; `afterPass(run)` - once the render pass ends; `afterFlush(run)` - after the urgent update flush.
- `hostOf(parent)` - the live parent when content mounts into a suspended boundary's stash.
- `text`, `marker`, `activeRoot` - read the active root; outside a render pass wrap calls in `within(root, run)`.
- `vnode`, `isVNode`, `PORTAL`, `LEAD` - build or recognize elements and portals.
- `fragment(root)` - a fragment whose commits wait until it attaches; `isComment(node, data)` - recognize a marker; `isBare(property)` - CSS properties that take unitless numbers.

## Styles

A root styles its elements when the host gives it a target and a sink (`documentOf` is exported):

```ts
const host: Host = {
  ...plain,
  target: documentOf,
  styles: (target) => sheetFor(target),
  patch(fiber, value, previous) {
    const { className, declarations } = fiber.claimed!;
    /* write props, then the class and declarations against previous */
  }
};
```

`styles(target)` returns a `Styles`: `open()` a sheet, `live()` while it lasts, `insert(rule, index)`, `root(key, css)` for pack variable defaults, `serialize(declarations)`. `hashed` names rules by content; `inline` writes unconditional rules into `style` - both for server output.

The core resolves rules, warns in dev on an unmatched `_flag`, throws on a reserved `_Name`, and passes children their style context. `_` props, `className` and `style` reach `patch` but are already in `fiber.claimed` - a styled `patch` skips them. Without `styles` nothing claims them: `plain` writes `_` props and `className` as attributes.

A host with its own reconciler styles each element with `styleElement(styles, type, props, appearance?, dev?)` - it returns the element's `claim` and the `inner` appearance its children render under. Call `syncRoots(styles)` before a pass so pack variable defaults are written - the core does this for its own roots. `flatten(claim)` folds rule declarations into inline ones. React styling is planned on this seam; the adapter doesn't use it yet.

## Hydration

`Hydration` adopts markup instead of creating nodes: `adopt`, `adoptText` and `adoptRange` place nodes, reusing existing ones; `adopted(node)` tells which were reused; `hydrating` runs a pass and removes what went unadopted; `keep`/`reserve` hold a suspended range's server markup until it renders; `aside` creates without adopting. dom's implementation is the reference.

A `Hydration` calls `text`/`marker`, which need an active root. To unit-test one outside a render, run it inside `within({ host, container }, () => ...)`.

## Typing a host

Element and tag types come from one augmentation of mvc's `Host` manifest:

```ts
declare module '@expressive/mvc/host' {
  interface Host {
    node: MyNode;                      // what Component.render returns
    intrinsics: MyTags;                // JSX.IntrinsicElements
    elementClass: { render(): MyNode };
  }
}
```

One augmentation per TypeScript program - two hosts with different tag types cannot share one. A second host in the same build keeps to Components, without intrinsic tags.

A host adapter that replaces element creation itself (React) registers with `host()` from `@expressive/jsx/jsx-runtime`; one such runtime per realm.

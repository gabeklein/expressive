import type { Node as RenderNode, VNode } from '../node/vnode';
import type { Appearance } from '../style/claim';
import { documentOf } from '../style/protocol';
import type { Styles, StyleTarget } from '../style/protocol';
import { syncRoots } from '../style/root';
import type { Container, Fiber } from './fiber';
import { complete } from './mount';
import { reconcileChildren } from './reconcile';

/** Where a render lands: its host, the node it renders into, and that node's style target, if any. */
interface Root {
  host: Host;
  container: globalThis.Node;
  target?: StyleTarget;
  styles?: Styles;
}

/**
 * What a render needs from its platform.
 *
 * Nodes are shaped like DOM nodes. The core walks `parentNode`/`nextSibling`, calls `getRootNode()`, writes a text node's `nodeValue`, empties a container with `replaceChildren()`, and moves nodes with `insertBefore`, `appendChild`, `prepend`, `append` and `remove`.
 * Inserting a fragment moves its children, not the fragment.
 */
interface Host {
  /** Style target for a container - hosts without styles omit it. */
  target?(container: globalThis.Node): StyleTarget;
  /** Where a target's rules go - hosts without styles omit it. */
  styles?(target: StyleTarget): Styles;
  text(root: Root, value: string): globalThis.Node;
  marker(root: Root, kind: string): globalThis.Node;
  fragment(root: Root): DocumentFragment;
  /**
   * Mount an intrinsic element - a string type - into `fiber`.
   *
   * Insert its node at `parent` before `before`, set `start` and `end` to it, then set props and reconcile `value.props.children` inside `complete()`, so a suspended mount can be parked.
   */
  mount(fiber: Fiber, value: VNode, parent: globalThis.Node, before: globalThis.Node | null, appearance?: Appearance): Fiber;
  /** Update props and reconcile children, as `mount` does. */
  patch(fiber: Fiber, value: VNode, appearance?: Appearance): void;
  /** Release what `mount` attached - the core removes the node. */
  unmount(fiber: Fiber): void;
  /** Adopt existing markup instead of creating nodes - dom's hydration. Without it, `hydrate()` renders instead, clearing the container. */
  hydration?: Hydration;
  /** Resolve a string `Portal` target - a selector, for dom. Without it, targets must be nodes. */
  locate?(into: string, parent: globalThis.Node): Container;
  /** Called once a portal and its children mount, `adopted` if its anchor came from existing markup. */
  portaled?(fiber: Fiber, adopted: boolean): void;
  /** Redirect a child before it mounts, as dom sends `<title>` to the head. */
  hoist?(value: RenderNode, parent: globalThis.Node): RenderNode;
}

/** A root for `host` rendering into `container`, with the container's style target and its styles. */
function rootOf(host: Host, container: globalThis.Node): Root {
  const target = host.target?.(container);

  return { host, container, target, styles: target && host.styles?.(target) };
}

const isEvent = (key: string) => /^on[A-Z]/.test(key);

function ownerOf(root: Root) {
  return documentOf(root.container);
}

const limp: Host = {
  text: (root, value) => ownerOf(root).createTextNode(value),
  marker: (root, kind) => ownerOf(root).createComment(kind),
  fragment: (root) => ownerOf(root).createDocumentFragment(),
  mount(fiber, value, parent, before) {
    fiber.start = fiber.end = parent.insertBefore(ownerOf(fiber.root!).createElement(value.type as string), before);

    return complete(fiber, () => limp.patch(fiber, value));
  },
  patch(fiber, value) {
    const element = fiber.start as Element;
    const previous = fiber.props!;
    const next = value.props as Record<string, any>;

    for (const key of Object.keys({ ...previous, ...next })) {
      if (key == 'children' || key == 'key' || previous[key] === next[key]) continue;

      if (isEvent(key)) {
        const name = key.slice(2).toLowerCase();

        if (typeof previous[key] == 'function') element.removeEventListener(name, previous[key]);
        if (typeof next[key] == 'function') element.addEventListener(name, next[key]);
      }
      else if (next[key] == null || next[key] === false || typeof next[key] == 'object' || typeof next[key] == 'function') element.removeAttribute(key);
      else element.setAttribute(key, next[key] === true ? '' : String(next[key]));
    }

    fiber.props = next;
    reconcileChildren(fiber, element, null, next.children, fiber.context, fiber.boundary);
  },
  unmount(fiber) {
    for (const key of Object.keys(fiber.props!))
      if (isEvent(key) && typeof fiber.props![key] == 'function') (fiber.start as Element).removeEventListener(key.slice(2).toLowerCase(), fiber.props![key]);
  }
};

let current: Root | undefined;

function within<T>(root: Root, run: () => T): T {
  const previous = current;
  current = root;

  if (root.styles) syncRoots(root.styles);

  try {
    return run();
  } finally {
    current = previous;
  }
}

function activeRoot() {
  return current!;
}

/**
 * How a host adopts existing markup instead of creating nodes - dom's hydration.
 *
 * Without one, every node is created and inserted.
 */
interface Hydration {
  /** Place a node at `parent` before `before` - an existing one `match` accepts, else `create()`. */
  adopt<T extends globalThis.Node>(parent: globalThis.Node, before: globalThis.Node | null, create: () => T, match: (node: globalThis.Node) => boolean): T;
  /** True for a node `adopt` took from existing markup. */
  adopted(node: globalThis.Node): boolean;
  /** Place a text node, adopting one that holds `value`. */
  adoptText(parent: globalThis.Node, before: globalThis.Node | null, value: string): globalThis.Node;
  /** Place a range's start and end markers. */
  adoptRange(parent: globalThis.Node, before: globalThis.Node | null, kind: string): [globalThis.Node, globalThis.Node];
  /** Run `work` creating nodes, not adopting them. */
  aside<T>(work: () => T): T;
  /**
   * Run `work` adopting what is under `root`, then remove what went unadopted.
   *
   * On resume, `from` and `to` are a kept range's own markers, and only nodes between them are claimed or removed.
   */
  hydrating<T>(root: globalThis.Node, work: () => T, from?: globalThis.Node | null, to?: globalThis.Node | null): T;
  /**
   * Keep a suspended range's existing markup until it renders. True if there was some.
   *
   * A `true` commits the hydration to a later `hydrating(parent, work, start, end)` for that range.
   */
  keep(start: globalThis.Node, end: globalThis.Node): boolean;
  /** Leave a range alone when cleaning up unadopted nodes. */
  reserve(start: globalThis.Node, end: globalThis.Node): void;
}

function text(value: string) {
  const root = activeRoot();
  return root.host.text(root, value);
}

function marker(kind: string) {
  const root = activeRoot();
  return root.host.marker(root, kind);
}

function isComment(node: globalThis.Node, data: string) {
  return node.nodeType == 8 && (node as Comment).data == data;
}

const plain: Omit<Hydration, 'adopted' | 'hydrating'> = {
  adopt: (parent, before, create) => parent.insertBefore(create(), before),
  adoptText: (parent, before, value) => parent.insertBefore(text(value), before),
  adoptRange(parent, before, kind) {
    const start = parent.insertBefore(marker(kind), before);
    return [start, parent.insertBefore(marker(`/${kind}`), before)];
  },
  aside: (work) => work(),
  keep: () => false,
  reserve() {}
};

function hydrationOf() {
  return activeRoot().host.hydration || plain;
}

function resume<T>(fiber: Fiber, work: () => T): T {
  return fiber.root!.host.hydration!.hydrating(fiber.end.parentNode!, work, fiber.start, fiber.end);
}

export { activeRoot, hydrationOf, isComment, limp, marker, resume, rootOf, text, within };
export type { Host, Hydration, Root };

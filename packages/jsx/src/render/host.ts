import { isEvent } from '../node/tags';
import type { Node as RenderNode, VNode } from '../node/vnode';
import type { Appearance } from '../style/claim';
import { documentOf } from '../style/protocol';
import type { Styles, StyleTarget } from '../style/protocol';
import type { Fiber } from './fiber';
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
 * Nodes are shaped like DOM nodes. The core walks `parentNode`/`nextSibling`, calls `getRootNode()`, writes a text node's `nodeValue`, and moves nodes with `insertBefore`, `appendChild`, `prepend`, `append` and `remove`.
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
  /** Redirect a child before it mounts, as dom sends `<title>` to the head. */
  hoist?(value: RenderNode, parent: globalThis.Node): RenderNode;
}

/** A root for `host` rendering into `container`, with the container's style target and its styles. */
function rootOf(host: Host, container: globalThis.Node): Root {
  const target = host.target?.(container);

  return { host, container, target, styles: target && host.styles?.(target) };
}

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

export { limp, rootOf };
export type { Host, Root };

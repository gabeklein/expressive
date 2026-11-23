import { isEvent } from '../node/tags';
import type { Node as RenderNode, VNode } from '../node/vnode';
import type { Appearance } from '../style/claim';
import { documentOf } from '../style/protocol';
import type { StyleTarget } from '../style/protocol';
import { mountElement, patchProps, unmountElement } from './element';
import type { Fiber } from './fiber';
import { complete } from './mount';
import { hoist } from './portal';
import { reconcileChildren } from './reconcile';
import { targetOf } from './target';

/** Where a render lands: its host, the node it renders into, and that node's style target, if any. */
interface Root {
  host: Host;
  container: globalThis.Node;
  target?: StyleTarget;
}

/**
 * What a render needs from its platform.
 *
 * Nodes are tree-shaped like DOM nodes: the reconciler walks `parentNode`/`nextSibling` and moves them with `insertBefore`, `appendChild` and `remove`.
 */
interface Host {
  /** Style target for a container - hosts without styles omit it. */
  target?(container: globalThis.Node): StyleTarget;
  text(root: Root, value: string): globalThis.Node;
  marker(root: Root, kind: string): globalThis.Node;
  fragment(root: Root): DocumentFragment;
  /** Mount an intrinsic element - a string type - into `fiber`, setting its `start` and `end`. */
  mount(fiber: Fiber, value: VNode, parent: globalThis.Node, before: globalThis.Node | null, appearance?: Appearance): Fiber;
  patch(fiber: Fiber, value: VNode, appearance?: Appearance): void;
  unmount(fiber: Fiber): void;
  /** Redirect a child before it mounts, as dom sends `<title>` to the head. */
  hoist?(value: RenderNode, parent: globalThis.Node): RenderNode;
}

const dom: Host = {
  target: targetOf,
  text: (root, value) => documentOf(root.target!).createTextNode(value),
  marker: (root, kind) => documentOf(root.target!).createComment(kind),
  fragment: (root) => documentOf(root.target!).createDocumentFragment(),
  mount: mountElement,
  patch: patchProps,
  unmount: unmountElement,
  hoist
};

function ownerOf(root: Root) {
  return documentOf(root.container);
}

const limp: Host = {
  text: (root, value) => ownerOf(root).createTextNode(value),
  marker: (root, kind) => ownerOf(root).createComment(kind),
  fragment: (root) => ownerOf(root).createDocumentFragment(),
  mount(fiber, value, parent, before, appearance) {
    fiber.start = fiber.end = parent.insertBefore(ownerOf(fiber.root!).createElement(value.type as string), before);

    return complete(fiber, () => limp.patch(fiber, value, appearance));
  },
  patch(fiber, value) {
    const element = fiber.start as Element;
    const previous = fiber.props!;
    const next = value.props as Record<string, any>;

    for (const key of Object.keys({ ...previous, ...next })) {
      if (key == 'children' || key == 'key' || previous[key] === next[key]) continue;

      if (isEvent(key)) {
        const name = key.slice(2).toLowerCase();

        if (previous[key]) element.removeEventListener(name, previous[key]);
        if (next[key]) element.addEventListener(name, next[key]);
      }
      else if (next[key] == null || next[key] === false) element.removeAttribute(key);
      else element.setAttribute(key, next[key] === true ? '' : String(next[key]));
    }

    fiber.props = next;
    reconcileChildren(fiber, element, null, next.children, fiber.context, fiber.boundary);
  },
  unmount(fiber) {
    for (const key of Object.keys(fiber.props!))
      if (isEvent(key)) (fiber.start as Element).removeEventListener(key.slice(2).toLowerCase(), fiber.props![key]);
  }
};

export { dom, limp };
export type { Host, Root };

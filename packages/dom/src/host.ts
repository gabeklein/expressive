import { LEAD, PORTAL, activeRoot, documentOf, hostOf, hydrate as hydrateWith, isVNode, render as renderWith, vnode } from '@expressive/jsx';
import type { Container, Fiber, Host, RenderNode, StyleTarget } from '@expressive/jsx';

import { hydration } from './hydrate';
import { mountElement, patchProps, settleProps, unmountElement } from './render/element';
import { stylesOf } from './style';
import { SVG, isHoisted } from './tags';

const dom: Host = {
  target: targetOf,
  styles: stylesOf,
  text: (root, value) => documentOf(root.target!).createTextNode(value),
  marker: (root, kind) => documentOf(root.target!).createComment(kind),
  fragment: (root) => documentOf(root.target!).createDocumentFragment(),
  mount: mountElement,
  patch: patchProps,
  settle: settleProps,
  unmount: unmountElement,
  hoist,
  hydration,
  locate,
  portaled
};

const hoisted = new WeakSet<globalThis.Node>();

/**
 * Mount a node into a container and return its unmount.
 *
 * Replaces the container's children and any root rendered there before. Unmount is idempotent.
 * A throw during the first render unmounts what it built, then propagates.
 */
function render(node: RenderNode, container: Container): () => void {
  return renderWith(node, container, dom);
}

/**
 * Mount a node over `renderToString` markup in the container, adopting its nodes.
 *
 * Nodes the render does not claim are removed.
 * Mismatched nodes are replaced where they differ. A subtree that suspends keeps its server markup until it renders.
 * Returns the unmount, as `render()` does.
 */
function hydrate(node: RenderNode, container: Container): () => void {
  return hydrateWith(node, container, dom);
}

/** A container's style target - its shadow root, else its document. */
function targetOf(container: globalThis.Node): StyleTarget {
  const root = container.getRootNode();

  return root.nodeType == 9 || isShadowRoot(root) ? root as StyleTarget : container.ownerDocument!;
}

function isShadowRoot(node: globalThis.Node): node is ShadowRoot {
  return node.nodeType == 11 && 'host' in node;
}

/** The document the rendering root lives in. */
function activeDocument() {
  return documentOf(activeRoot().container);
}

/** Send a top-level `<title>`, `<meta>` or `<link>` to the document head, as a portal. */
function hoist(value: RenderNode, parent: globalThis.Node): RenderNode {
  if (!isVNode(value) || !isHoisted(value.type, value.props)) return value;

  const host = hostOf(parent) as Element;

  if (host.closest?.('head') || isShadowRoot(host.getRootNode())) return value;
  if (host.namespaceURI == SVG && host.localName != 'foreignObject') return value;

  return vnode(PORTAL, { into: activeDocument().head, children: value, [LEAD]: value.type == 'title' }, value.key);
}

function locate(into: string, parent: globalThis.Node): Container {
  const root = parent.getRootNode();
  const found = [...activeDocument().querySelectorAll(into)];

  if (root.nodeType == 11) found.push(...(root as DocumentFragment).querySelectorAll(into));

  if (found.length != 1)
    throw new Error(`Portal target "${into}" ${found.length ? 'is ambiguous' : 'was not found'}.`);

  return found[0];
}

/** Retire the server's copy of a hoisted head element once the client's mounts over it. */
function portaled(fiber: Fiber, adopting: boolean) {
  if (!(LEAD in fiber.props!)) return;

  const element = fiber.children[0].start as Element;

  hoisted.add(element);

  if (adopting)
    for (const twin of fiber.portalContainer!.children)
      if (!hoisted.has(twin) && twin.outerHTML == element.outerHTML) return retire(twin, element);
}

function retire(twin: Element, element: Element) {
  if (!/\bstylesheet\b/i.test(String(element.getAttribute('rel')))) return twin.remove();

  const remove = () => twin.remove();

  element.addEventListener('load', remove, { once: true });
  element.addEventListener('error', remove, { once: true });
}

export { activeDocument, dom, hydrate, render };

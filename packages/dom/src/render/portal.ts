import { Context } from '@expressive/mvc';

import { isHoisted } from '../node/props';
import { isVNode, PORTAL, vnode } from '../node/vnode';
import type { Node as RenderNode, VNode } from '../node/vnode';
import type { Appearance } from '../style/claim';
import { moveRange } from './fiber';
import type { Boundary, Container, Fiber } from './fiber';
import { adopt, adopted, aside, isComment, reserve } from './hydrate';
import { hostOf } from './suspense';
import { complete } from './mount';
import { reconcileChildren } from './reconcile';
import { targetOf, within } from './target';

function mountPortal(value: VNode, parent: globalThis.Node, before: globalThis.Node | null, context: Context, boundary?: Boundary, appearance?: Appearance) {
  const marker = adopt(parent, before, () => document.createComment('portal'), (node) => isComment(node, 'portal'));
  const container = target(value.props.into, parent);
  const portalStart = document.createComment('portal-root');
  const portalEnd = document.createComment('/portal-root');

  if (value.props[LEAD]) container.prepend(portalStart, portalEnd);
  else container.append(portalStart, portalEnd);

  reserve(portalStart, portalEnd);

  const output: Fiber = {
    kind: 'portal',
    key: value.key,
    type: PORTAL,
    props: value.props,
    context,
    boundary,
    appearance,
    start: marker,
    end: marker,
    children: [],
    portalContainer: container,
    portalStart,
    portalEnd,
    target: targetOf(container)
  };

  complete(output, () => {
    aside(() => reconcilePortal(output, value.props.children, context, boundary, appearance));
  });

  if (LEAD in value.props) replace(output, adopted(marker));

  return output;
}

const hoisted = new WeakSet<globalThis.Node>();

function replace(fiber: Fiber, adopting: boolean) {
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

const SVG = 'http://www.w3.org/2000/svg';
const LEAD = Symbol('lead');

function hoist(value: RenderNode, parent: globalThis.Node): RenderNode {
  if (!isVNode(value) || !isHoisted(value.type, value.props)) return value;

  const host = hostOf(parent) as Element;

  if (host.closest?.('head') || host.getRootNode() instanceof ShadowRoot) return value;
  if (host.namespaceURI == SVG && host.localName != 'foreignObject') return value;

  return vnode(PORTAL, { into: parent.ownerDocument!.head, children: value, [LEAD]: value.type == 'title' }, value.key);
}

function target(into: unknown, parent: globalThis.Node): Container {
  if (typeof into != 'string') return into as Container;

  const root = parent.getRootNode();
  const found = [...document.querySelectorAll(into)];

  if (root instanceof DocumentFragment) found.push(...root.querySelectorAll(into));

  if (found.length != 1)
    throw new Error(`Portal target "${into}" ${found.length ? 'is ambiguous' : 'was not found'}.`);

  return found[0];
}

function reconcilePortal(fiber: Fiber, value: RenderNode, context: Context, boundary?: Boundary, appearance?: Appearance) {
  within(fiber.target, () => reconcileChildren(fiber, fiber.portalEnd!.parentNode!, fiber.portalEnd!, value, context, boundary, appearance));
}

function leads(props: object) {
  return !!(props as Record<symbol, unknown>)[LEAD];
}

function place(fiber: Fiber, content: globalThis.Node) {
  if (leads(fiber.props!)) fiber.portalContainer!.prepend(content);
  else fiber.portalContainer!.append(content);
}

function patchPortal(fiber: Fiber, value: VNode, context: Context, appearance?: Appearance) {
  const moved = leads(fiber.props!) !== leads(value.props) && fiber.portalStart!.parentNode === fiber.portalContainer;

  fiber.appearance = appearance;
  fiber.props = value.props;

  if (moved) {
    const content = document.createDocumentFragment();

    moveRange(fiber.portalStart!, fiber.portalEnd!, content);
    place(fiber, content);
  }

  reconcilePortal(fiber, value.props.children, context, fiber.boundary, appearance);
}

function unmountPortal(fiber: Fiber) {
  (fiber.portalStart as ChildNode).remove();
  (fiber.portalEnd as ChildNode).remove();
}

export { hoist, mountPortal, patchPortal, place, unmountPortal };

import { Context } from '@expressive/mvc';

import { isHoisted } from '../node/props';
import { isVNode, PORTAL, vnode } from '../node/vnode';
import type { Node as RenderNode, VNode } from '../node/vnode';
import type { Appearance } from '../style/claim';
import { moveRange } from './fiber';
import type { Boundary, Container, Fiber } from './fiber';
import { hostOf } from './suspense';
import { complete } from './mount';
import { reconcileChildren } from './reconcile';

function mountPortal(value: VNode, parent: globalThis.Node, before: globalThis.Node | null, context: Context, boundary?: Boundary, appearance?: Appearance) {
  const marker = document.createComment('portal');
  const container = target(value.props.into, parent);
  const portalStart = document.createComment('portal-root');
  const portalEnd = document.createComment('/portal-root');

  parent.insertBefore(marker, before);
  if (value.props[LEAD]) container.prepend(portalStart, portalEnd);
  else container.append(portalStart, portalEnd);

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
    portalEnd
  };

  return complete(output, () => {
    reconcilePortal(output, value.props.children, context, boundary, appearance);
  });
}

const SVG = 'http://www.w3.org/2000/svg';
const LEAD = Symbol('lead');

function hoist(value: RenderNode, parent: globalThis.Node): RenderNode {
  if (!isVNode(value) || !isHoisted(value.type, value.props)) return value;

  const { head } = parent.ownerDocument!;
  const host = hostOf(parent) as Element;

  if (head.contains(host) || parent.getRootNode() instanceof ShadowRoot) return value;
  if (host.namespaceURI == SVG && host.localName != 'foreignObject') return value;

  return vnode(PORTAL, { into: head, children: value, [LEAD]: value.type == 'title' }, value.key);
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
  reconcileChildren(fiber, fiber.portalEnd!.parentNode!, fiber.portalEnd!, value, context, boundary, appearance);
}

function leads(props: object) {
  return !!(props as Record<symbol, unknown>)[LEAD];
}

function place(fiber: Fiber, content: globalThis.Node) {
  if (leads(fiber.props!)) fiber.portalContainer!.prepend(content);
  else fiber.portalContainer!.append(content);
}

function patchPortal(fiber: Fiber, value: VNode, context: Context, appearance?: Appearance) {
  if (leads(fiber.props!) !== leads(value.props) && fiber.portalStart!.parentNode === fiber.portalContainer) {
    const content = document.createDocumentFragment();

    moveRange(fiber.portalStart!, fiber.portalEnd!, content);
    fiber.props = value.props;
    place(fiber, content);
  }

  fiber.appearance = appearance;
  fiber.props = value.props;
  reconcilePortal(fiber, value.props.children, context, fiber.boundary, appearance);
}

function unmountPortal(fiber: Fiber) {
  (fiber.portalStart as ChildNode).remove();
  (fiber.portalEnd as ChildNode).remove();
}

export { hoist, mountPortal, patchPortal, place, unmountPortal };

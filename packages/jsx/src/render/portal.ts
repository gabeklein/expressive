import { Context } from '@expressive/mvc';

import { PORTAL } from '../node/vnode';
import type { Node as RenderNode, VNode } from '../node/vnode';
import type { Appearance } from '../style/claim';
import { moveRange } from './fiber';
import type { Boundary, Container, Fiber } from './fiber';
import { adopt, adopted, aside, isComment, marker, reserve } from './hydrate';
import { complete } from './mount';
import { reconcileChildren } from './reconcile';
import { rootOf } from './host';
import { activeDocument, activeRoot, within } from './target';

function mountPortal(value: VNode, parent: globalThis.Node, before: globalThis.Node | null, context: Context, boundary?: Boundary, appearance?: Appearance) {
  const anchor = adopt(parent, before, () => marker('portal'), (node) => isComment(node, 'portal'));
  const container = target(value.props.into, parent);
  const root = rootOf(activeRoot().host, container);
  const portalStart = root.host.marker(root, 'portal-root');
  const portalEnd = root.host.marker(root, '/portal-root');

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
    start: anchor,
    end: anchor,
    children: [],
    portalContainer: container,
    portalStart,
    portalEnd,
    root
  };

  complete(output, () => {
    aside(() => reconcilePortal(output, value.props.children, context, boundary, appearance));
  });

  if (LEAD in value.props) replace(output, adopted(anchor));

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

const LEAD = Symbol('lead');


function target(into: unknown, parent: globalThis.Node): Container {
  if (typeof into != 'string') return into as Container;

  const root = parent.getRootNode();
  const found = [...activeDocument().querySelectorAll(into)];

  if (root.nodeType == 11) found.push(...(root as DocumentFragment).querySelectorAll(into));

  if (found.length != 1)
    throw new Error(`Portal target "${into}" ${found.length ? 'is ambiguous' : 'was not found'}.`);

  return found[0];
}

function reconcilePortal(fiber: Fiber, value: RenderNode, context: Context, boundary?: Boundary, appearance?: Appearance) {
  within(fiber.root!, () => reconcileChildren(fiber, fiber.portalEnd!.parentNode!, fiber.portalEnd!, value, context, boundary, appearance));
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
    const content = fiber.root!.host.fragment(fiber.root!);

    moveRange(fiber.portalStart!, fiber.portalEnd!, content);
    place(fiber, content);
  }

  reconcilePortal(fiber, value.props.children, context, fiber.boundary, appearance);
}

function unmountPortal(fiber: Fiber) {
  (fiber.portalStart as ChildNode).remove();
  (fiber.portalEnd as ChildNode).remove();
}

export { LEAD, mountPortal, patchPortal, place, unmountPortal };

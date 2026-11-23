import { Context } from '@expressive/mvc';

import { PORTAL } from '../node/vnode';
import type { Node as RenderNode, VNode } from '../node/vnode';
import type { Appearance } from '../style/claim';
import { moveRange } from './fiber';
import type { Boundary, Container, Fiber } from './fiber';
import { hydrationOf, isComment, marker } from './host';
import { complete } from './mount';
import { reconcileChildren } from './reconcile';
import { rootOf } from './host';
import type { Host } from './host';
import { activeRoot, within } from './host';

function mountPortal(value: VNode, parent: globalThis.Node, before: globalThis.Node | null, context: Context, boundary?: Boundary, appearance?: Appearance) {
  const hydration = hydrationOf();
  const anchor = hydration.adopt(parent, before, () => marker('portal'), (node) => isComment(node, 'portal'));
  const { host } = activeRoot();
  const container = locate(host, value.props.into, parent);
  const root = { ...rootOf(host, container), waiting: activeRoot().waiting };
  const portalStart = root.host.marker(root, 'portal-root');
  const portalEnd = root.host.marker(root, '/portal-root');

  if (value.props[LEAD]) container.prepend(portalStart, portalEnd);
  else container.append(portalStart, portalEnd);

  hydration.reserve(portalStart, portalEnd);

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
    hydration.aside(() => reconcilePortal(output, value.props.children, context, boundary, appearance));
  });

  host.portaled?.(output, !!host.hydration?.adopted(anchor));

  return output;
}

const LEAD = Symbol('lead');

function locate(host: Host, into: unknown, parent: globalThis.Node): Container {
  if (typeof into != 'string') return into as Container;
  if (host.locate) return host.locate(into, parent);

  throw new Error(`Portal target "${into}" needs a node - this host resolves no selectors.`);
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

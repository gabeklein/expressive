import { Context } from '@expressive/mvc';
import type { Component } from '@expressive/mvc';
import { Fragment } from '../jsx-runtime';

import { kindOf } from '../node/kind';
import type { Collection } from '../node/kind';
import type { Node as RenderNode, VNode } from '../node/vnode';
import { placed, styleElement } from '../style/claim';
import type { Appearance } from '../style/claim';
import { dispose } from '../core/adapter';
import { mountCollection } from './collection';
import { mountComponent, mountFunction, mountOwnedComponent, unmountComponent } from './component';
import { range, removeRange } from './fiber';
import type { Boundary, Fiber } from './fiber';
import { untrack } from '../core/hot';
import { hydrationOf } from './host';
import { mountPortal, unmountPortal } from './portal';
import { reconcile, reconcileChildren } from './reconcile';
import { rendering } from './render';
import { activeRoot } from './host';
import { hold, unwait } from './suspense';

function complete<T extends Fiber>(fiber: T, work: () => void): T {
  try {
    work();
  } catch (error) {
    if (!hold(fiber, error)) unmountFiber(fiber);

    throw error;
  }

  return fiber;
}

function mount(value: RenderNode, parent: globalThis.Node, before: globalThis.Node | null, context: Context, boundary?: Boundary, appearance?: Appearance): Fiber {
  switch (kindOf(value, rendering)) {
    case 'text': {
      const text = hydrationOf().adoptText(parent, before, String(value));
      return { kind: 'text', value, context, start: text, end: text, children: [] };
    }
    case 'component':
      return mountComponent(value as Component, parent, before, context, boundary, placed(appearance));
    case 'collection':
      return mountCollection(value as Collection, parent, before, context, boundary, appearance);
    case 'fragment':
      return mountFragment(value as VNode, parent, before, context, boundary, appearance);
    case 'portal':
      return mountPortal(value as VNode, parent, before, context, boundary, appearance);
    case 'element': {
      const root = activeRoot();
      const { key, type } = value as VNode;
      const fiber: Fiber = { kind: 'element', key, type, props: {}, context, boundary, root, start: parent, end: parent, children: [] };

      fiber.start = fiber.end = root.host.mount(fiber, value as VNode, parent, before);

      return complete(fiber, () => patchElement(fiber, value as VNode, appearance));
    }
    case 'owned':
      return mountOwnedComponent(value as VNode, parent, before, context, boundary, appearance);
    default:
      return mountFunction(value as VNode, parent, before, context, boundary, appearance);
  }
}

function mountFragment(value: VNode, parent: globalThis.Node, before: globalThis.Node | null, context: Context, boundary?: Boundary, appearance?: Appearance) {
  const fiber = range('fragment', parent, before, context);
  fiber.key = value.key;
  fiber.type = Fragment;
  fiber.appearance = appearance;

  return complete(fiber, () => {
    reconcile(fiber, value.props.children, context, boundary, appearance);
  });
}

function patchElement(fiber: Fiber, value: VNode, appearance?: Appearance) {
  const { host, styles } = fiber.root!;
  const previous = fiber.claimed;
  const styled = styles && styleElement(styles, fiber.type as string, value.props, appearance, value.source);

  fiber.appearance = appearance;
  if (styled) fiber.claimed = styled.claim;

  const owned = host.patch(fiber, value, previous) === false;

  fiber.props = value.props;

  if (!owned)
    reconcileChildren(fiber, fiber.start, null, value.props.children, fiber.context, fiber.boundary, styled?.inner);

  if (host.settle) {
    host.settle(fiber, value, fiber.settled || {});
    fiber.settled = value.props;
  }
}

function patchText(fiber: Fiber, value: RenderNode) {
  const next = String(value);
  if (fiber.start.nodeValue !== next) fiber.start.nodeValue = next;
  fiber.value = value;
}

function patchFragment(fiber: Fiber, value: VNode, context: Context, appearance?: Appearance) {
  fiber.context = context;
  fiber.appearance = appearance;
  reconcile(fiber, value.props.children, context, fiber.boundary, appearance);
}

/**
 * Unmount a fiber and everything under it, then remove its nodes.
 *
 * Releases components and suspensions, and calls `Host.unmount` for each element. For a host replacing reconciled children itself - see `Host.patch`.
 */
function unmountFiber(fiber: Fiber) {
  fiber.dead = true;
  unwait(fiber);

  for (let index = fiber.children.length - 1; index >= 0; index--)
    unmountFiber(fiber.children[index]);

  if (fiber.placeholder) unmountFiber(fiber.placeholder);

  fiber.suspended?.forEach((clear) => clear());
  if (fiber.kind == 'function') untrack(fiber.type as Function, fiber.scope!);
  if (fiber.scope) dispose(fiber.scope);
  fiber.release?.();

  if (fiber.kind == 'element') fiber.root!.host.unmount(fiber);
  else if (fiber.kind == 'component') unmountComponent(fiber);
  else if (fiber.kind == 'portal') unmountPortal(fiber);

  removeRange(fiber.start, fiber.end);
}

export { complete, mount, patchElement, patchFragment, patchText, unmountFiber };

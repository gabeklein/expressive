import { Context } from '@expressive/mvc';

import { ALIASES, isEvent, isStringified } from '../node/props';
import type { VNode } from '../node/vnode';
import { applyClaim, claim } from '../style/claim';
import type { Appearance } from '../style/claim';
import { unmatched } from '../style/diagnose';
import { reserved } from '../style/protocol';
import { inserted } from './commits';
import type { Boundary, Fiber } from './fiber';
import { complete, unmountFiber } from './mount';
import { reconcileChildren } from './reconcile';
import { depth, focus, focusing } from './render';
import { afterFlush } from '../core/scheduler';
import { adopt, adopted, touch } from './hydrate';
import { hostOf } from './suspense';
import { activeTarget } from './target';

const SVG = 'http://www.w3.org/2000/svg';
const CONTROLS = ['checked', 'value'];
const CONTENT = ['dangerouslySetInnerHTML', 'innerHTML', 'innerText', 'textContent'];
const controlled = new WeakMap<Element, Fiber>();
const attached = new WeakMap<Fiber, unknown>();
const restoring = new WeakSet<Document | ShadowRoot>();

function mountElement(value: VNode, parent: globalThis.Node, before: globalThis.Node | null, context: Context, boundary?: Boundary, appearance?: Appearance) {
  const tag = value.type as string;
  const host = hostOf(parent);
  const namespace = tag == 'svg' || host instanceof SVGElement && host.localName != 'foreignObject' ? SVG : undefined;
  const element = adopt(
    parent,
    before,
    () => namespace ? document.createElementNS(SVG, tag) : document.createElement(tag),
    (node) => node.nodeType == 1 && (node as Element).localName == tag && ((node as Element).namespaceURI == SVG) == !!namespace
  );
  const fiber: Fiber = {
    kind: 'element',
    key: value.key,
    type: tag,
    props: {},
    context,
    boundary,
    start: element,
    end: element,
    children: [],
    events: new Map()
  };

  const adopting = adopted(element);

  if (adopting) {
    prune(element, value.props);
    fiber.claimed = { className: element.getAttribute('class') || '', declarations: {} };
    if (tag != 'textarea' && !CONTENT.some((key) => key in value.props)) touch(element);
  }

  if (!adopting && (value.props.autofocus || value.props.autoFocus))
    inserted(fiber, () => {
      focusing.push(element);
      if (!depth) focus();
    });

  return complete(fiber, () => {
    patchProps(fiber, value, appearance, adopting);
  });
}

function attributeOf(key: string) {
  return ALIASES[key] || key;
}

function prune(element: Element, props: Record<string, any>) {
  const expected = new Set(['class', element.localName == 'option' ? 'selected' : 'class']);

  for (const key of Object.keys(props)) {
    const value = props[key];

    if (value == null || value === false || typeof value == 'function') continue;

    expected.add(attributeOf(key).toLowerCase());
    if (key == 'defaultValue' || key == 'defaultChecked') expected.add(key.slice(7).toLowerCase());
  }

  for (const name of element.getAttributeNames())
    if (name == 'style' || !expected.has(name.toLowerCase())) element.removeAttribute(name);
}

function patchProps(fiber: Fiber, value: VNode, appearance?: Appearance, adopting?: boolean) {
  const next = value.props as Record<string, any>;
  const element = fiber.start as Element;
  const previous = fiber.props!;
  const raw = 'dangerouslySetInnerHTML' in next;
  const resolved = appearance?.context?.resolve(next, fiber.type as string);

  unmatched(value.source, next, [appearance?.context], appearance?.author, undefined, fiber.type as string);

  if (raw) {
    for (let index = fiber.children.length - 1; index >= 0; index--)
      unmountFiber(fiber.children[index]);
    fiber.children = [];
  }

  for (const key of Object.keys({ ...previous, ...next })) {
    if (key[0] == '_') {
      reserved(key);
      continue;
    }

    if (key == 'children' || key == 'className' || key == 'key' || key == 'ref' || key == 'style' || CONTROLS.includes(key)) continue;
    if (previous[key] === next[key]) continue;
    if (adopting && unchanged(element, key, next[key])) continue;
    patchProp(fiber, element, key, previous[key], next[key]);
  }

  const claimed = claim(activeTarget()!, appearance, resolved, next.className, next.style);

  applyClaim(element, fiber.claimed, claimed);
  fiber.claimed = claimed;
  fiber.appearance = appearance;

  if (!raw) {
    reconcileChildren(
      fiber,
      element,
      null,
      next.children,
      fiber.context,
      fiber.boundary,
      claimed.context || appearance?.author
        ? { author: appearance?.author, context: claimed.context, entries: [] }
        : undefined
    );
  }

  for (const key of CONTROLS) {
    const value = next[key];
    const live = (element as any)[key];
    const differs = value == null || !(key in element)
      ? previous[key] !== value
      : key == 'value' ? String(live) !== String(value) : live !== value;

    if (differs) patchProp(fiber, element, key, previous[key], value);
  }

  if (CONTROLS.some((key) => next[key] != null)) {
    const root = activeTarget()!;

    controlled.set(element, fiber);

    if (!restoring.has(root)) {
      restoring.add(root);
      root.addEventListener('input', restoreTarget);
      root.addEventListener('change', restoreTarget);
    }
  }

  fiber.props = next;

  if (previous.ref !== next.ref) patchProp(fiber, element, 'ref', previous.ref, next.ref);
}

function patchProp(fiber: Fiber, element: Element, key: string, previous: any, next: any) {
  if (key == 'ref') {
    detachRef(fiber);
    inserted(fiber, () => {
      if (fiber.props!.ref !== next) return;
      attached.set(fiber, next);
      applyRef(next, element);
    });
    return;
  }

  if (key == 'dangerouslySetInnerHTML') {
    element.innerHTML = next?.__html || '';
    return;
  }

  if (isEvent(key)) {
    const capture = key.endsWith('Capture');
    const lower = (capture ? key.slice(2, -7) : key.slice(2)).toLowerCase();
    const name = lower == 'doubleclick' ? 'dblclick' : lower;
    const id = `${name}:${capture}`;
    const current = fiber.events!.get(id);

    if (current) element.removeEventListener(name, current, capture);
    if (typeof next == 'function') {
      fiber.events!.set(id, next);
      element.addEventListener(name, next, capture);
    } else fiber.events!.delete(id);
    return;
  }

  const name = attributeOf(key);

  if (isStringified(key) && next != null) {
    element.setAttribute(name, String(next));
    return;
  }

  if (next === null || next === undefined || next === false) {
    if (key in element && typeof (element as any)[key] != 'function')
      try {
        const current = (element as any)[key];
        (element as any)[key] = typeof current == 'boolean'
          ? false
          : typeof current == 'number'
            ? 0
            : '';
      } catch {}
    element.removeAttribute(element.namespaceURI === SVG ? name.toLowerCase() : name);
    element.removeAttribute(name);
    return;
  }

  if (key in element && (element.namespaceURI !== SVG || settable(element, key)))
    try {
      (element as any)[key] = next;
      return;
    } catch {}

  element.setAttribute(name, next === true ? '' : String(next));
}

function unchanged(element: Element, key: string, value: unknown) {
  return (typeof value == 'string' || typeof value == 'number') && element.getAttribute(attributeOf(key)) === String(value);
}

function restoreTarget(event: Event) {
  const element = event.target as HTMLInputElement;
  const fiber = controlled.get(element);

  if (fiber && event.type == settles(fiber.props!, element))
    queueMicrotask(() => afterFlush(() => restore(fiber)));
}

function settles(props: Record<string, any>, element: HTMLInputElement) {
  if (props.onInput) return 'input';
  if (props.onChange) return 'change';
  return element.type == 'checkbox' || element.type == 'radio' || element.localName == 'select' ? 'change' : 'input';
}

function restore(fiber: Fiber) {
  const element = fiber.start as any;

  for (const key of CONTROLS) {
    const value = fiber.props![key];

    if (value == null || fiber.dead) continue;
    if (key == 'value' ? String(element.value) !== String(value) : element[key] !== value)
      element[key] = value;
  }
}

function settable(element: Element, key: string) {
  let target: object = element;
  let descriptor: PropertyDescriptor | undefined;

  while (!(descriptor = Object.getOwnPropertyDescriptor(target, key)))
    target = Object.getPrototypeOf(target);

  return !!(descriptor.set || descriptor.writable);
}

function applyRef(ref: unknown, value: Element | null) {
  if (typeof ref == 'function') ref(value);
  else if (ref && typeof ref == 'object' && 'current' in ref) (ref as { current: Element | null }).current = value;
}

function detachRef(fiber: Fiber) {
  applyRef(attached.get(fiber), null);
  attached.delete(fiber);
}

function unmountElement(fiber: Fiber) {
  detachRef(fiber);
  for (const [id, listener] of fiber.events!) {
    const [name, capture] = id.split(':');
    (fiber.start as Element).removeEventListener(name, listener, capture === 'true');
  }
}

export { mountElement, patchProps, unmountElement };

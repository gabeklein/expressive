import { afterEach, vi } from 'vitest';

import type { Component, Model } from '@expressive/mvc';

import { mockPromise } from '../mvc/test.setup';
import { vnode } from './src/node/vnode';
import { limp } from './src/render/host';
import type { Host } from './src/render/host';
import { complete } from './src/render/mount';
import { reconcileChildren } from './src/render/reconcile';
import { render as renderWith } from './src/render/render';
import { claim } from './src/style/claim';
import type { Claim } from './src/style/claim';
import { unmatched } from './src/style/diagnose';
import { documentOf, reserved } from './src/style/protocol';
import type { Declaration, Styles } from './src/style/protocol';

function declare(style: CSSStyleDeclaration, declarations: Declaration, previous: Declaration = {}) {
  for (const key of Object.keys({ ...previous, ...declarations })) {
    const value = declarations[key];
    const css = key.startsWith('--') ? key : key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());

    style.setProperty(css, value == null ? '' : typeof value == 'number' && value && !key.startsWith('--') ? `${value}px` : String(value));
  }
}

function sheet(document: Document): Styles {
  const roots = new Map<object, HTMLStyleElement>();
  let element: HTMLStyleElement | undefined;

  return {
    open() {
      element = document.head.appendChild(document.createElement('style'));
      element.dataset.expressive = 'sheet';
    },
    live: () => !!element?.sheet,
    insert: (rule, index) => element!.sheet!.insertRule(rule, index),
    root(key, css) {
      let root = roots.get(key);

      if (!root?.isConnected) {
        roots.set(key, root = document.head.appendChild(document.createElement('style')));
        root.dataset.expressive = 'root';
      }

      root.textContent = css;
    },
    serialize(declarations) {
      const { style } = document.createElement('div');

      declare(style, declarations);
      return style.cssText;
    }
  };
}

const sheets = new WeakMap<Document, Styles>();
const claimed = new WeakMap<Element, Claim>();

/** limp with a stylesheet: classes and inline declarations from the style engine. */
export const styled: Host = {
  ...limp,
  target: documentOf,
  styles(target) {
    const document = documentOf(target);
    let styles = sheets.get(document);

    if (!styles) sheets.set(document, styles = sheet(document));

    return styles;
  },
  mount(fiber, value, parent, before, appearance) {
    fiber.start = fiber.end = parent.insertBefore(documentOf(parent).createElement(value.type as string), before);

    return complete(fiber, () => styled.patch(fiber, value, appearance));
  },
  patch(fiber, value, appearance) {
    const element = fiber.start as HTMLElement;
    const { children, className, style, key: _, ...props } = value.props as Record<string, any>;
    const previous = claimed.get(element);

    unmatched(value.source, value.props, [appearance?.context], appearance?.author, undefined, fiber.type as string);

    for (const key in props)
      if (key[0] == '_') reserved(key);
      else if (props[key] == null || props[key] === false) element.removeAttribute(key);
      else element.setAttribute(key, props[key] === true ? '' : String(props[key]));

    const next = claim(fiber.root!.styles!, appearance, appearance?.context?.resolve(value.props, fiber.type as string), className, style);

    if (next.className) element.setAttribute('class', next.className);
    else element.removeAttribute('class');

    declare(element.style, next.declarations, previous?.declarations);
    claimed.set(element, next);
    fiber.props = value.props;
    reconcileChildren(fiber, element, null, children, fiber.context, fiber.boundary,
      next.context || appearance?.author ? { author: appearance?.author, context: next.context, entries: [] } : undefined);
  },
  unmount() {}
};

let host: Host = limp;

/** Render this file's `mount` and `place` through `next` - limp by default. */
export function useHost(next: Host) {
  host = next;
}

/** Render through this file's host. */
export const render = (node: Component.Node, root: Element | DocumentFragment) => renderWith(node as any, root, host);

afterEach(() => {
  document.body.replaceChildren();
});

export { mockError, mockPromise, mockWarn, flushMicrotasks } from '../mvc/test.setup';

export const until = <T>(assert: () => T) => vi.waitFor(assert, { interval: 1 });

export function mount<T extends Model>(
  Type: new (...args: any[]) => T,
  props?: object,
  root: HTMLElement = document.createElement('main')
): [T, HTMLElement, () => void] {
  let instance!: T;
  const release = render(vnode(Type as any, { ...props, is: (value: T) => (instance = value) }), root);
  return [instance, root, release];
}

export function lazy<T = () => Component.Node>() {
  const loaded = mockPromise<T>();
  return [vi.fn(() => loaded) as () => typeof loaded, loaded] as const;
}

export function track(promise: PromiseLike<unknown>) {
  let settled = false;
  promise.then(() => (settled = true));
  return () => settled;
}

export const html = (root: Element) => root.innerHTML.replace(/<!--[^>]*-->/g, '');

export function place(node: Component.Node, root: HTMLElement = document.createElement('main')) {
  render(node, root);
  return root;
}

declare module '@expressive/mvc/jsx-runtime' {
  interface Host {
    intrinsics: Record<string, Record<string, any>>;
  }
}

declare module '@expressive/jsx/jsx-runtime' {
  namespace JSX {
    interface IntrinsicAttributes {
      style?: unknown;
      [attribute: `_${string}`]: unknown;
    }
  }
}

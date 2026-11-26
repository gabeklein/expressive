import { afterEach, vi } from 'vitest';

import type { Component, Model } from '@expressive/mvc';

import { mockPromise } from '../mvc/test.setup';
import { vnode } from './src/node/vnode';
import { plain } from './src/render/host';
import type { Host } from './src/render/host';
import { render as renderWith } from './src/render/render';
import { isBare } from './src/style/numeric';
import { documentOf } from './src/style/protocol';
import type { Declaration, Styles } from './src/style/protocol';

function declare(style: CSSStyleDeclaration, declarations: Declaration, previous: Declaration = {}) {
  for (const key of Object.keys({ ...previous, ...declarations })) {
    const value = declarations[key];
    const custom = key.startsWith('--');
    const css = custom ? key : key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());

    style.setProperty(css, value == null ? '' : typeof value == 'number' && value && !custom && !isBare(key) ? `${value}px` : String(value));
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

      return Object.keys(declarations).map((key) => {
        style.cssText = '';
        declare(style, { [key]: declarations[key] });
        return style.cssText;
      }).filter(Boolean).join(' ');
    }
  };
}

const sheets = new WeakMap<Document, Styles>();

/** The plain host with a stylesheet: classes and inline declarations from the style engine. */
export const styled: Host = {
  ...plain,
  target: documentOf,
  styles(target) {
    const document = target as Document;
    let styles = sheets.get(document);

    if (!styles) sheets.set(document, styles = sheet(document));

    return styles;
  },
  mount: (_fiber, value, parent, before) => parent.insertBefore(documentOf(parent).createElement(value.type as string), before),
  patch(fiber, value, previous) {
    const element = fiber.start as HTMLElement;
    const { children, className, style, key: _, ...props } = value.props as Record<string, any>;
    const { className: classes, declarations } = fiber.claimed!;

    for (const key of Object.keys({ ...fiber.props, ...props })) {
      const prop = props[key];

      if (key[0] == '_' || key == 'children' || key == 'className' || key == 'style' || key == 'key') continue;
      else if (prop == null || prop === false || typeof prop == 'object' || typeof prop == 'function') element.removeAttribute(key);
      else element.setAttribute(key, prop === true ? '' : String(prop));
    }

    if (classes) element.setAttribute('class', classes);
    else element.removeAttribute('class');

    declare(element.style, declarations, previous?.declarations);
  },
  unmount() {}
};

let host: Host = plain;

/** Render this file's `mount` and `place` through `next` - the plain host by default. */
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

export const attached = () => document.body.appendChild(document.createElement('main'));

/** Test helpers rendering through `render`, reading rules from `style[data-expressive=<sheet>]`. */
export function harness(render: (node: Component.Node, root: Element | DocumentFragment) => () => void, sheet: string) {
  function mount<T extends Model>(
    Type: new (...args: any[]) => T,
    props?: object,
    root: HTMLElement = document.createElement('main')
  ): [T, HTMLElement, () => void] {
    let instance!: T;
    const release = render(vnode(Type as any, { ...props, is: (value: T) => (instance = value) }), root);
    return [instance, root, release];
  }

  function place(node: Component.Node, root: HTMLElement = document.createElement('main')) {
    render(node, root);
    return root;
  }

  function rules(match = '') {
    return [...document.head.querySelector<HTMLStyleElement>(`style[data-expressive=${sheet}]`)!.sheet!.cssRules]
      .map((rule) => rule.cssText.replace(/\s+/g, ' '))
      .filter((rule) => rule.includes(match));
  }

  return { mount, place, rules };
}

export const { mount, place, rules } = harness(render, 'sheet');

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

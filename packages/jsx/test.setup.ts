import { afterEach, vi } from 'vitest';
import type { Component, Model } from '@expressive/mvc';

import { mockPromise } from '../mvc/test.setup';
import { limp } from './src/render/host';
import type { Host } from './src/render/host';
import { render as renderWith } from './src/render/render';
import { vnode } from './src/node/vnode';

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

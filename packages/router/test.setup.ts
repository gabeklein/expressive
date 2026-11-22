import { afterEach, beforeEach, vi } from 'vitest';
import { render as mount } from '@expressive/dom';
import type { Component } from '@expressive/mvc';

import '../mvc/test.setup';

import { Context } from '@expressive/mvc';
import { BrowserRouter } from './src/browser';

/** Run renders, suspense retries and the navigations they trigger to completion. */
async function settle() {
  for (let turn = 0; turn < 2; turn++)
    await vi.runAllTimersAsync();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(async () => {
  await vi.runAllTimersAsync();
  vi.useRealTimers();
});

const mounted = new Set<() => void>();

afterEach(() => {
  mounted.forEach((unmount) => unmount());
  mounted.clear();
  document.body.innerHTML = '';
});

export { mockError, mockPromise, mockWarn } from '../mvc/test.setup';

/**
 * Opt-in per-test BrowserRouter lifecycle. Call at the top of a describe (or
 * file) that needs one; returns a live handle whose `.router` is refreshed
 * before each test and torn down after. happy-dom dispatches `hashchange` on a
 * timer, so one queued by an earlier test is dropped before it reaches the router.
 */
export function browserRouter() {
  const ctx = {} as { current: BrowserRouter };

  const stale = (event: Event) => {
    if (event.timeStamp <= since) event.stopImmediatePropagation();
  };

  let since = 0;

  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    since = performance.now();
    window.addEventListener('hashchange', stale);
    ctx.current = BrowserRouter.new(Context.root);
  });

  afterEach(() => {
    ctx.current.set(null);
    window.removeEventListener('hashchange', stale);
  });

  return ctx;
}

/** Set the current location without navigating - seeds a test's initial URL. */
export const location = (path: string) => window.history.replaceState(null, '', path);

/** Mount into a container on `document.body`; unmounted after each test. */
export function render(ui: Component.Node) {
  const container = document.body.appendChild(document.createElement('div'));
  let unmount = mount(ui, container);

  mounted.add(() => unmount());

  return {
    container,
    rerender(next: Component.Node) {
      unmount = mount(next, container);
    },
    unmount() {
      unmount();
    }
  };
}

/** Run `fn`, then flush pending dispatch and renders. */
export async function act(fn: () => unknown) {
  await fn();
  await settle();
}

/** `render`, then flush - for trees that navigate/settle on mount. */
export async function renderAct(ui: Component.Node) {
  const view = render(ui);
  await settle();
  return view;
}

/** The deepest element on the page whose text is exactly `text`; throws if none. */
export function getByText(text: string) {
  const found = Array.from(document.body.querySelectorAll('*')).filter(
    (el) => el.textContent === text && !Array.from(el.children).some((child) => child.textContent === text)
  );

  if (found.length !== 1)
    throw new Error(`Expected one element with text "${text}", found ${found.length}.`);

  return found[0];
}

/** Run `fn` with `window` swapped for `win` (absent when undefined), then restore it. */
export function withWindow<T>(win: object | undefined, fn: () => T): T {
  const saved = (globalThis as any).window;

  try {
    if (win)
      (globalThis as any).window = win;
    else
      delete (globalThis as any).window;

    return fn();
  } finally {
    (globalThis as any).window = saved;
  }
}

import { describe, it, expect } from 'vitest';
import { renderToString } from '@expressive/dom/server';
import { Context } from '@expressive/mvc';

import { Route } from './route';
import { BrowserRouter } from './browser';
import { Router } from './router';

const page = async () => {
  const { html } = await renderToString(
    <Route to="*">
      <h1>Home</h1>
    </Route>,
    { markers: false }
  );

  return html;
};

describe('router SSR probe (no window)', () => {
  it('will render requests independently without registering a root Router', async () => {
    const saved = window;

    delete (globalThis as any).window;

    try {
      expect(typeof window).toBe('undefined');

      const [a, b] = await Promise.all([page(), page()]);

      expect(Context.root.get(Router, false)).toBeUndefined();
      expect(Context.root.get(BrowserRouter, false)).toBeUndefined();
      expect(a).toContain('<h1>Home</h1>');
      expect(b).toBe(a);
    } finally {
      (globalThis as any).window = saved;
    }
  });
});

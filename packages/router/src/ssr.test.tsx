import { describe, it, expect } from 'vitest';
import { renderToString } from '@expressive/dom/server';
import { Component, Context } from '@expressive/mvc';

import { Redirect } from './redirect';
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

describe('Redirect on the server', () => {
  class Sync extends Router {
    protected async next(url: string) {
      this.locate(url);
    }
  }

  it.each([
    ['a held navigation', Router],
    ['one applied at once', Sync]
  ])('will render the target after %s', async (_, Type) => {
    let router!: Router;
    const { html } = await renderToString(
      <Component for={Type} is={(r: Router) => { router = r; r.path = '/old'; }}>
        <Route to="/old" as={() => { throw new Redirect('/'); }} />
        <Route to="/" as={() => <h1>Home</h1>} />
      </Component>,
      { markers: false }
    );

    expect(html).toBe('<h1>Home</h1>');
    expect(router.path).toBe('/');
  });
});

import { describe, expect, it } from 'vitest';
import { Component, Model } from '@expressive/mvc';

import { act, browserRouter, location, mockPromise, mockUncaught, render, renderAct } from '../test.setup';
import { Redirect } from './redirect';
import { Route } from './route';
import { Router } from './router';

const router = browserRouter();

describe('Redirect', () => {
  it('will navigate when thrown while rendering', async () => {
    location('/legacy');
    const Legacy = () => {
      throw new Redirect('/new');
    };
    const view = await renderAct(
      <>
        <Route to="/legacy" as={Legacy} />
        <Route to="/new" as={() => <h1>new</h1>} />
      </>
    );
    expect(window.location.pathname).toBe('/new');
    expect(view.container.textContent).toBe('new');
  });

  it('will navigate when thrown from new()', async () => {
    location('/legacy');
    class Legacy extends Component {
      protected new() {
        throw new Redirect('/new');
      }
    }
    const view = await renderAct(
      <>
        <Route to="/legacy" as={Legacy} />
        <Route to="/new" as={() => <h1>new</h1>} />
      </>
    );
    expect(window.location.pathname).toBe('/new');
    expect(view.container.textContent).toBe('new');
  });

  it('will navigate when async new() rejects', async () => {
    location('/legacy');
    class Legacy extends Component {
      protected async new() {
        await null;
        throw new Redirect('/new');
      }
    }
    const view = await renderAct(
      <>
        <Route to="/legacy" as={Legacy} />
        <Route to="/new" as={() => <h1>new</h1>} />
      </>
    );
    expect(window.location.pathname).toBe('/new');
    expect(view.container.textContent).toBe('new');
  });

  it('will push from the held screen, not replace it', async () => {
    location('/');
    const module = mockPromise<{ default: () => never }>();
    const view = await renderAct(
      <>
        <Route to="/" as={() => <h1>home</h1>} />
        <Route to="/me" as={() => module} />
        <Route to="/login" as={() => <h1>login</h1>} />
      </>
    );
    const before = window.history.length;

    await act(() => router.current.goto('/me'));
    expect(view.container.textContent).toBe('home');

    await act(() => module.resolve({ default: () => { throw new Redirect('/login'); } }));
    expect(view.container.textContent).toBe('login');
    expect(window.location.pathname).toBe('/login');
    expect(window.history.length).toBe(before + 1);

    await act(() => window.history.back());
    expect(window.location.pathname).toBe('/');
  });

  it('will not navigate from a tree abandoned mid-hold', async () => {
    location('/');
    const module = mockPromise<{ default: () => never }>();
    const view = await renderAct(
      <>
        <Route to="/" as={() => <h1>home</h1>} />
        <Route to="/me" as={() => module} />
        <Route to="/about" as={() => <h1>about</h1>} />
        <Route to="/login" as={() => <h1>login</h1>} />
      </>
    );

    await act(() => router.current.goto('/me'));
    await act(() => router.current.goto('/about'));
    await act(() => module.resolve({ default: () => { throw new Redirect('/login'); } }));

    expect(view.container.textContent).toBe('about');
    expect(window.location.pathname).toBe('/about');
  });

  it('will replace the entry on a cold load', async () => {
    location('/legacy');
    const before = window.history.length;
    await renderAct(
      <>
        <Route to="/legacy" as={() => { throw new Redirect('/new'); }} />
        <Route to="/new" as={() => null} />
      </>
    );
    expect(window.location.pathname).toBe('/new');
    expect(window.history.length).toBe(before);
  });

  it('will replace an entry pushed outside the router', async () => {
    location('/');
    await renderAct(
      <>
        <Route to="/" as={() => null} />
        <Route to="/legacy" as={() => { throw new Redirect('/new'); }} />
        <Route to="/new" as={() => null} />
      </>
    );
    const before = window.history.length;

    await act(() => window.history.pushState(null, '', '/legacy'));
    expect(window.location.pathname).toBe('/new');
    expect(window.history.length).toBe(before + 1);
  });

  it('will resolve `to` against the catching Route', async () => {
    location('/posts/foo');
    await renderAct(
      <>
        <Route to="/posts/:id" as={() => { throw new Redirect('./edit'); }} />
        <Route to="/posts/:id/edit" as={() => null} />
      </>
    );
    expect(window.location.pathname).toBe('/posts/foo/edit');
  });

  it('will pass on a redirect caught before the last one lands', async () => {
    location('/a');
    const caught: Error[] = [];
    const view = await renderAct(
      <Component catch={(error) => { caught.push(error); return new Promise(() => {}); }}>
        <Route to="/a" as={() => { throw new Redirect('/b'); }} />
        <Route to="/b" as={() => { throw new Redirect('/a'); }} />
      </Component>
    );
    expect(caught).toEqual([new Redirect('/a')]);
    expect(window.location.pathname).toBe('/b');
    expect(view.container.textContent).toBe('');
  });

  it('will pass on other errors', async () => {
    location('/');
    const failure = new Error('broken');
    const caught: Error[] = [];
    await renderAct(
      <Component catch={(error) => { caught.push(error); return new Promise(() => {}); }}>
        <Route to="/" as={() => { throw failure; }} />
      </Component>
    );
    expect(caught).toEqual([failure]);
  });

  it('will redirect from an override deferring to super', async () => {
    location('/a');
    class Page extends Route {
      catch(error: Error) {
        return super.catch(error);
      }
    }
    await renderAct(
      <>
        <Page to="/a" as={() => { throw new Redirect('/b'); }} />
        <Route to="/b" as={() => null} />
      </>
    );
    expect(window.location.pathname).toBe('/b');
  });

  it('will not catch an async rejection outside a Route', async () => {
    const uncaught = mockUncaught();
    const redirect = new Redirect('/b');
    class Session extends Model {
      protected async new() {
        throw redirect;
      }
    }
    render(<Route to="/" />);
    await act(() => { Session.new(); });
    expect(uncaught).toEqual([redirect]);
  });

  it('will not catch a redirect thrown from an effect', async () => {
    const uncaught = mockUncaught();
    const redirect = new Redirect('/b');
    class Ticker extends Component {
      tick = 0;
      protected new() {
        this.get(($) => {
          if ($.tick) throw redirect;
        });
      }
    }
    let ticker!: Ticker;
    location('/');
    await renderAct(<Route to="/" as={() => <Ticker is={(t) => void (ticker = t)} />} />);
    await act(() => { ticker.tick = 1; });
    expect(uncaught).toEqual([redirect]);
    expect(window.location.pathname).toBe('/');
  });

  it('will replace through a chain on a cold load', async () => {
    location('/a');
    const before = window.history.length;
    await renderAct(
      <>
        <Route to="/a" redirect="/b" />
        <Route to="/b" as={() => { throw new Redirect('/c'); }} />
        <Route to="/c" as={() => null} />
      </>
    );
    expect(window.location.pathname).toBe('/c');
    expect(window.history.length).toBe(before);
  });

  it('will replace the entry a replacing navigation meant to', async () => {
    location('/');
    await renderAct(
      <>
        <Route to="/" as={() => null} />
        <Route to="/dash" as={() => { throw new Redirect('/onboard'); }} />
        <Route to="/onboard" as={() => null} />
      </>
    );
    const before = window.history.length;

    await act(() => router.current.goto('/dash', true));
    expect(window.location.pathname).toBe('/onboard');
    expect(window.history.length).toBe(before);
  });

  it('will replace an entry a memory router stepped back into', async () => {
    const memory = Router.new();
    await renderAct(
      <Component for={memory}>
        <Route to="/" as={() => null} />
        <Route to="/admin" as={() => { throw new Redirect('/login'); }} />
        <Route to="/login" as={() => null} />
        <Route to="/x" as={() => null} />
      </Component>
    );
    Object.assign(memory, { entries: ['/', '/admin', '/x'], index: 2, path: '/x' });

    await act(() => memory.back());
    expect(memory.path).toBe('/login');

    await act(() => memory.go(1));
    expect(memory.path).toBe('/x');

    await act(() => memory.go(-2));
    expect(memory.path).toBe('/');
  });

  it('will not navigate when async new() rejects after the page was left', async () => {
    location('/me');
    const check = mockPromise<void>();
    class Me extends Component {
      protected async new() {
        await check;
      }
    }
    await renderAct(
      <>
        <Route to="/me" as={Me} />
        <Route to="/about" as={() => null} />
      </>
    );

    await act(() => router.current.goto('/about'));
    await act(async () => {
      check.reject(new Redirect('/login'));
      await check.catch(() => {});
    });
    expect(window.location.pathname).toBe('/about');
  });

  it('will navigate when a Route subclass rejects its own async new()', async () => {
    location('/me');
    class Guard extends Route {
      protected async new() {
        await null;
        throw new Redirect('/login');
      }
    }
    await renderAct(
      <>
        <Guard to="/me" />
        <Route to="/login" as={() => null} />
      </>
    );
    expect(window.location.pathname).toBe('/login');
  });
});


import { act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';

import { browserRouter, mockPromise, renderAct } from '../test.setup';
import { NavLinks } from './nav';
import { Route } from './route';

const router = browserRouter();

const current = (view: any) =>
  view.container.querySelector('a[aria-current="page"]')?.getAttribute('href');

const links = (view: any) =>
  Array.from(view.container.querySelectorAll('a')).map((a: any) => a.getAttribute('href'));

const page = (Nav: typeof NavLinks = NavLinks) => ({ children }: { children?: React.ReactNode }) => (
  <div>
    <span data-page />
    <Nav />
    {children}
  </div>
);

const Page = page();

it('will mirror the route tree, labelling by label then path', async () => {
  const view = await renderAct(
    <Route as={Page}>
      <Route to="a" label="Alpha" />
      <Route to="b" />
    </Route>
  );
  expect(links(view)).toEqual(['/a', '/b']);
  expect(view.container.textContent).toBe('Alpha/b');
});

it('will skip redirect and none rows', async () => {
  const view = await renderAct(
    <Route as={Page}>
      <Route to="a" />
      <Route to="old" redirect="/a" />
      <Route none as={() => <div>fallback</div>} />
    </Route>
  );
  expect(links(view)).toEqual(['/a']);
});

it('will treat a headless scope as a section, not a link', async () => {
  const view = await renderAct(
    <Route as={Page}>
      <Route to="posts/*">
        <Route to="recent" />
      </Route>
    </Route>
  );
  expect(links(view)).toEqual(['/posts/recent']);
});

it('will mark the active link and update on navigation', async () => {
  router.current.goto('/a');

  const view = await renderAct(
    <Route as={Page}>
      <Route to="a" />
      <Route to="b" />
    </Route>
  );
  expect(current(view)).toBe('/a');

  await act(async () => router.current.goto('/b'));
  expect(current(view)).toBe('/b');
});

it('will pass route and meta to an overridden Item', async () => {
  class MyNav extends NavLinks {
    Item({ route, meta }: { route: NavLinks.Entry; meta: NavLinks.Entry['meta'] }) {
      return <a href={route.path} data-custom>{meta?.label ?? route.path}</a>;
    }
  }

  const view = await renderAct(
    <Route as={page(MyNav)}>
      <Route to="a" meta={{ label: 'Alpha' }} />
      <Route to="b" />
    </Route>
  );
  expect(links(view)).toEqual(['/a', '/b']);
  expect(view.container.querySelectorAll('a[data-custom]').length).toBe(2);
  expect(view.container.textContent).toBe('Alpha/b');
});

it('will render an anonymous group transparently', async () => {
  const view = await renderAct(
    <Route as={Page}>
      <Route>
        <Route to="a" />
        <Route to="b" />
      </Route>
    </Route>
  );
  expect(links(view)).toEqual(['/a', '/b']);
});

it('will wrap a group via an overridden Group slot', async () => {
  class Sectioned extends NavLinks {
    Group({ route, children }: { route: NavLinks.Entry; children?: React.ReactNode }) {
      return <section data-group>{route.label}{children}</section>;
    }
  }

  const view = await renderAct(
    <Route as={page(Sectioned)}>
      <Route label="Docs">
        <Route to="a" />
      </Route>
    </Route>
  );
  expect(view.container.querySelector('section[data-group]')!.textContent).toBe('Docs/a');
  expect(links(view)).toEqual(['/a']);
});

it('will suspend the whole nav, not one row, when an Item suspends', async () => {
  const pending = mockPromise();
  let ready = false;
  pending.then(() => (ready = true));

  class MyNav extends NavLinks {
    Item({ route }: { route: NavLinks.Entry }) {
      if (route.path === '/b' && !ready) throw pending;
      return <a href={route.path}>{route.path}</a>;
    }
  }

  const view = await renderAct(
    <Route as={page(MyNav)}>
      <Route to="a" />
      <Route to="b" />
    </Route>
  );
  expect(links(view)).toEqual([]);
  expect(view.container.querySelector('[data-page]')).toBeTruthy();

  await act(async () => pending.resolve());
  expect(links(view)).toEqual(['/a', '/b']);
});

it('will show NavLinks fallback while an Item suspends', async () => {
  const pending = mockPromise();
  let ready = false;
  pending.then(() => (ready = true));

  class MyNav extends NavLinks {
    fallback = (<span data-pending />);

    Item({ route }: { route: NavLinks.Entry }) {
      if (!ready) throw pending;
      return <a href={route.path}>{route.path}</a>;
    }
  }

  const view = await renderAct(
    <Route as={page(MyNav)}>
      <Route to="a" />
    </Route>
  );
  expect(view.container.querySelector('[data-pending]')).toBeTruthy();

  await act(async () => pending.resolve());
  expect(view.container.querySelector('[data-pending]')).toBeNull();
  expect(links(view)).toEqual(['/a']);
});

it('will list routes declared after it in a single-pass render', () => {
  const html = renderToString(
    <Route as={Page}>
      <Route to="a" label="Alpha" />
      <Route to="b" />
    </Route>
  );

  expect(html).toContain('href="/a"');
  expect(html).toContain('href="/b"');
});

it('will mark a scope with a page active while a child matches', async () => {
  router.current.goto('/docs/a');

  const view = await renderAct(
    <Route as={Page}>
      <Route to="docs" as={({ children }: { children?: React.ReactNode }) => <>{children}</>}>
        <Route to="a" />
      </Route>
      <Route to="b" />
    </Route>
  );

  const marked = Array.from(view.container.querySelectorAll('a[aria-current="page"]')).map((a: any) => a.getAttribute('href'));

  expect(marked).toEqual(['/docs', '/docs/a']);
});

it('will list routes its own scope contributes in a single-pass render', () => {
  class Docs extends Route {
    protected get children(): React.ReactNode {
      return <><Route to="intro" />{super.children}</>;
    }
  }

  const html = renderToString(
    <Docs as={Page}>
      <Route to="api" />
    </Docs>
  );

  expect(html).toContain('href="/intro"');
  expect(html).toContain('href="/api"');
});

it('will list routes a nested scope contributes once it mounts', async () => {
  class Generated extends Route {
    protected get children(): React.ReactNode {
      return <>{super.children}<Route to="made" /></>;
    }
  }

  const tree = (
    <Route as={Page}>
      <Generated to="g">
        <Route to="declared" />
      </Generated>
    </Route>
  );

  expect(renderToString(tree)).not.toContain('href="/g/made"');
  expect(links(await renderAct(tree))).toEqual(['/g/declared', '/g/made']);
});

it('will re-render only the rows whose match changes on navigation', async () => {
  const renders: string[] = [];

  class Counted extends NavLinks {
    Item({ route, active }: { route: NavLinks.Entry; active: boolean }) {
      renders.push(route.path);
      return <a href={route.path} aria-current={active ? 'page' : undefined}>{route.path}</a>;
    }
  }

  router.current.goto('/a');

  await renderAct(
    <Route as={page(Counted)}>
      <Route to="a" />
      <Route to="b" />
      <Route to="c" />
      <Route to="d/*" />
    </Route>
  );

  renders.length = 0;
  await act(async () => router.current.goto('/b'));
  expect(renders.sort()).toEqual(['/a', '/b']);

  await act(async () => router.current.goto('/d/1'));
  renders.length = 0;
  await act(async () => router.current.goto('/d/2'));
  expect(renders).toEqual([]);
});

it('will link a scope that renders its own content, before and after mount', async () => {
  class Section extends Route {
    render() {
      return <section>{super.render()}</section>;
    }
  }

  const tree = (
    <Route as={Page}>
      <Route to="docs">
        <h1>Docs</h1>
        <Route to="a" />
      </Route>
      <Section to="guide">
        <Route to="b" />
      </Section>
    </Route>
  );

  const expected = ['/docs', '/docs/a', '/guide', '/guide/b'];
  const server = document.createElement('div');

  server.innerHTML = renderToString(tree);

  expect(links({ container: server })).toEqual(expected);
  expect(links(await renderAct(tree))).toEqual(expected);
});

it('will list a Route subclass that sets to as a field once it mounts', async () => {
  class Docs extends Route {
    to = 'docs';
    label = 'Docs';
  }

  const tree = (
    <Route as={Page}>
      <Docs />
      <Route to="b" />
    </Route>
  );

  const server = document.createElement('div');
  server.innerHTML = renderToString(tree);

  expect(links({ container: server })).toEqual(['/b']);
  expect(links(await renderAct(tree))).toEqual(['/docs', '/b']);
});

it('will render the same nav in a single pass as after mount', async () => {
  router.current.goto('/docs/a');

  const tree = (
    <Route as={Page}>
      <>
        <Route to="docs" label="Docs" as={({ children }: { children?: React.ReactNode }) => <>{children}</>}>
          <Route to="a" label="A" />
          <Route to="old" redirect={() => undefined} />
        </Route>
      </>
      <Route to="api">
        <Route to="model" />
      </Route>
      <Route none as={() => null} />
    </Route>
  );

  const nav = (root: Element) => root.querySelector('ul')!.outerHTML.replace(/<!--[^>]*-->/g, '');
  const server = document.createElement('div');

  server.innerHTML = renderToString(tree);

  expect(nav((await renderAct(tree)).container)).toBe(nav(server));
  expect(links({ container: server })).toEqual(['/docs', '/docs/a', '/api/model']);
  expect(server.querySelector('a[aria-current="page"]')!.getAttribute('href')).toBe('/docs');
});

it('will follow routes added and removed after mount', async () => {
  const tree = (extra: boolean) => (
    <Route as={Page}>
      <Route to="a" />
      {extra && <Route to="b" />}
    </Route>
  );

  const view = await renderAct(tree(true));
  expect(links(view)).toEqual(['/a', '/b']);

  await act(async () => view.rerender(tree(false)));
  expect(links(view)).toEqual(['/a']);

  await act(async () => view.rerender(tree(true)));
  expect(links(view)).toEqual(['/a', '/b']);
});

it('will list a Route subclass declared with props in a single pass', () => {
  class Host extends Route {}

  const html = renderToString(
    <Host as={Page}>
      <Host as={() => <p>home</p>} label="Home" />
      <Host to="guide" label="Guide">
        <Host as={() => <p>guide</p>} label="Guide" />
        <Host to="install" as={() => <p>install</p>} />
      </Host>
    </Host>
  );
  const server = document.createElement('div');

  server.innerHTML = html;

  expect(links({ container: server })).toEqual(['/', '/guide', '/guide/install']);
});

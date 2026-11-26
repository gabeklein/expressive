/** @jsxImportSource @expressive/react */
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Component } from '@expressive/mvc';
import * as hot from '@expressive/mvc/hot';
import { act } from '@testing-library/react';
import { Children, Fragment, StrictMode, Suspense, cloneElement, forwardRef, lazy, memo, use, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { hydrateRoot } from 'react-dom/client';
import { renderToReadableStream, renderToString } from 'react-dom/server';
import * as Refresh from 'react-refresh/runtime';
import '.';
import { Css, refresh, style, wrap } from './style';

let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  error = vi.spyOn(console, 'error');
});

afterEach(() => {
  expect(error).not.toHaveBeenCalled();
  error.mockRestore();
});

function sheet() {
  return [...document.querySelectorAll('style')].map((element) =>
    element.sheet ? [...element.sheet.cssRules].map((rule) => rule.cssText).join('\n') : element.textContent
  ).join('\n');
}

describe('style engine on react', () => {
  it('will emit rules and base declarations for a class component', () => {
    class Styled extends Component {
      active = true;

      render() {
        return <div _active={this.active}>styled</div>;
      }
    }

    style(Styled, {
      _active: { fontWeight: 700 },
      _div: { padding: '4px' },
      color: 'blue'
    });

    const { container } = render(<Styled />);
    const node = container.querySelector('div')!;

    expect(node.className.split(' ')).toEqual(['Styled_div', 'Styled_active', 'Styled']);
    expect(node.hasAttribute('_active')).toBe(false);
    expect(getComputedStyle(node).fontWeight).toBe('700');
    expect(getComputedStyle(node).color).toBe('blue');
  });

  it('will toggle a rule on re-render', async () => {
    class Toggle extends Component {
      active = true;

      render() {
        return <span _active={this.active} />;
      }
    }

    style(Toggle, { _active: { color: 'red' } });

    let instance!: Toggle;
    const { container } = render(<Toggle is={(self) => { instance = self; }} />);
    const node = container.querySelector('span')!;

    expect(node.className).toBe('Toggle_active');

    await vi.waitFor(async () => {
      instance.active = false;
      await Promise.resolve();
      expect(node.hasAttribute('class')).toBe(false);
    });
  });

  it('will emit conditions as rules', () => {
    function Link() {
      return <a _link>go</a>;
    }

    style(Link, {
      _link: {
        color: 'blue',
        ':hover': { color: 'red' },
        '@media (min-width: 600px)': { fontSize: '20px' }
      }
    });

    const { container } = render(<Link />);
    const node = container.querySelector('a')!;
    const css = sheet();

    expect(node.className).toContain('Link_link');
    expect(css).toMatch(/\.Link_link[^{]*:hover[^{]*\{[^}]*color: red/);
    expect(css).toMatch(/@media \(min-width: 600px\)/);
  });

  it('will resolve macros of a pack', () => {
    const css = Css.use();

    function Box() {
      return <div _box />;
    }

    css(Box, { _box: { padding: 8, size: 40 } });

    const node = render(<Box />).container.querySelector('div')!;

    expect(getComputedStyle(node).paddingTop).toBe('8px');
    expect(getComputedStyle(node).width).toBe('40px');
  });

  it('will let caller rules reach a child function root', () => {
    function Button() {
      return <button style={{ letterSpacing: 1 }}>go</button>;
    }

    style(Button, { color: 'blue', letterSpacing: '2px' });

    function Toolbar() {
      return <nav><Button _accent /></nav>;
    }

    style(Toolbar, { _accent: { color: 'red', letterSpacing: '3px' } });

    const button = render(<Toolbar />).container.querySelector('button')!;

    expect(button.className).toBe('Toolbar_accent-d1 Button');
    expect(getComputedStyle(button).color).toBe('red');
    expect(getComputedStyle(button).letterSpacing).toBe('1px');
  });

  it('will forward style through component roots', () => {
    const Leaf = (_props: any) => <div className="leaf" style={['local', { color: 'blue' }]} />;
    const Middle = (_props: any) => <Leaf style={['inner', { color: 'green', height: 4 }]} />;

    class View extends Component {
      render() {
        return <Middle style={['call', { color: 'red', width: 3 }]} />;
      }
    }

    const node = render(<View />).container.querySelector('div')!;

    expect(node.className).toBe('leaf local inner call');
    expect(node.style.color).toBe('red');
    expect(node.style.height).toBe('4px');
    expect(node.style.width).toBe('3px');
  });

  it('will keep the author\'s rules on children passed in', () => {
    class Card extends Component {
      render() {
        return <section _card>{this.props.children}</section>;
      }
    }

    style(Card, { _card: { padding: '4px' } });

    class Page extends Component {
      render() {
        return <Card><p _note>hello</p></Card>;
      }
    }

    style(Page, { _note: { color: 'green' } });

    const { container } = render(<Page />);

    expect(container.querySelector('section')!.className).toContain('Card_card');
    expect(container.querySelector('p')!.className).toBe('Page_note');
  });

  it('will style a subcomponent by key', () => {
    class Panel extends Component {
      Title() {
        return <h1>title</h1>;
      }

      render() {
        return <div><this.Title /></div>;
      }
    }

    style(Panel, { _Title: { color: 'purple' } });

    const node = render(<Panel />).container.querySelector('h1')!;

    expect(getComputedStyle(node).color).toBe('purple');
  });

  it('will define and read variables', () => {
    class Theme extends Css {
      $ink = 'crimson';
    }

    const css = Theme.use();

    function Callout() {
      return <p>note</p>;
    }

    css(Callout, ($) => ({ color: $.ink }));

    const node = render(<Callout />).container.querySelector('p')!;

    expect(node.className).toBe('Callout');
    expect(sheet()).toContain('--ink: crimson');
    expect(sheet()).toContain('var(--ink)');
  });
});

describe('probes', () => {
  it('will carry a descendant scope across a component boundary', () => {
    class Card extends Component {
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    class Page extends Component {
      render() {
        return <ul _list><Card><li _item>x</li></Card></ul>;
      }
    }

    style(Page, { _list: { _item: { color: 'red' } } });

    const li = render(<Page />).container.querySelector('li')!;
    expect(getComputedStyle(li).color).toBe('red');
  });

  it('will keep author for an element memoized across renders', async () => {
    class Card extends Component {
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    function Page({ tick }: { tick: number }) {
      const note = useMemo(() => <p _note>{'note'}</p>, []);
      return <Card key="c">{note}{tick}</Card>;
    }

    style(Page, { _note: { color: 'green' } });

    const view = render(<Page tick={0} />);
    view.rerender(<Page tick={1} />);

    expect(view.container.querySelector('p')!.className).toBe('Page_note');
  });

  it('will keep author through Children.map', () => {
    function Stack({ children }: { children?: ReactNode }) {
      return <div>{Children.map(children, (child) => <section>{child}</section>)}</div>;
    }

    function Page() {
      return <Stack><p _note>a</p><p _note>b</p></Stack>;
    }

    style(Page, { _note: { color: 'green' } });

    const nodes = render(<Page />).container.querySelectorAll('p');
    expect([...nodes].map((node) => node.className)).toEqual(['Page_note', 'Page_note']);
  });

  it('will keep author through cloneElement', () => {
    function Decorate({ children }: { children: ReactElement }) {
      return cloneElement(children, { title: 'decorated' } as any);
    }

    function Page() {
      return <Decorate><p _note>a</p></Decorate>;
    }

    style(Page, { _note: { color: 'green' } });

    const node = render(<Page />).container.querySelector('p')!;
    expect(node.title).toBe('decorated');
    expect(node.className).toBe('Page_note');
  });

  it('will resolve a render prop against the component calling it, as dom does', () => {
    function List({ item }: { item: (index: number) => ReactNode }) {
      return <ul>{[0, 1].map((index) => <Fragment key={index}>{item(index)}</Fragment>)}</ul>;
    }

    style(List, { _row: { color: 'blue' } });

    function Page() {
      return <List item={(index) => <li _row>{index}</li>} />;
    }

    style(Page, { _row: { color: 'green' } });

    const node = render(<Page />).container.querySelector('li')!;
    expect(node.className).toBe('List_row');
  });

  it('will resolve elements in a portal', () => {
    const target = document.body.appendChild(document.createElement('aside'));

    function Page() {
      return <div>{createPortal(<p _note>portal</p>, target)}</div>;
    }

    style(Page, { _note: { color: 'green' } });

    render(<Page />);
    const node = target.querySelector('p')!;
    expect(node.className).toBe('Page_note');
    expect(node.hasAttribute('_note')).toBe(false);
  });

  it('will host a memo component', () => {
    const Badge = memo(function Badge() {
      return <span _dot>b</span>;
    });

    style(Badge, { _dot: { color: 'red' } });

    function Page() {
      return <Badge _accent />;
    }

    style(Page, { _accent: { fontWeight: 700 } });

    const node = render(<Page />).container.querySelector('span')!;
    expect(node.className).toMatch(/_dot\b/);
    expect(node.className).toContain('Page_accent');
    expect(getComputedStyle(node).color).toBe('red');
  });

  it('will host a forwardRef component', () => {
    const Field = forwardRef<HTMLInputElement>(function Field(_props, ref) {
      return <input ref={ref} _field />;
    });

    style(Field, { _field: { color: 'red' } });

    const node = render(<Field />).container.querySelector('input')!;
    expect(node.className).toMatch(/_field\b/);
    expect(getComputedStyle(node).color).toBe('red');
  });

  it('will host a lazy component', async () => {
    function Lazy() {
      return <span _lazy>lazy</span>;
    }

    style(Lazy, { _lazy: { color: 'red' } });

    const Loaded = lazy(async () => ({ default: Lazy }));

    const view = render(<Suspense fallback={null}><Loaded /></Suspense>);
    await act(async () => {});
    expect(view.container.querySelector('span')!.className).toBe('Lazy_lazy');
  });

  it('will resolve a Suspense fallback', () => {
    const never = new Promise(() => {});

    function Hang(): ReactNode {
      throw never;
    }

    function Page() {
      return <Suspense fallback={<p _wait>wait</p>}><Hang /></Suspense>;
    }

    style(Page, { _wait: { color: 'gray' } });

    const node = render(<Page />).container.querySelector('p')!;
    expect(node.className).toBe('Page_wait');
  });

  it('will resolve under StrictMode', () => {
    function Page() {
      return <p _note>x</p>;
    }

    style(Page, { _note: { color: 'green' } });

    const node = render(<StrictMode><Page /></StrictMode>).container.querySelector('p')!;
    expect(node.className).toBe('Page_note');
  });

  it('will style content that resolves after suspending', async () => {
    let resolve!: () => void;
    const ready = new Promise<void>((done) => (resolve = done));
    let done = false;
    ready.then(() => (done = true));

    function Slow() {
      if (!done) throw ready;
      return <p _note>ready</p>;
    }

    style(Slow, { _note: { color: 'green' } });

    const view = render(<Suspense fallback={null}><Slow /></Suspense>);
    await act(async () => resolve());
    expect(view.container.querySelector('p')!.className).toBe('Slow_note');
  });

  it('will carry a class style map through hot.accept', async () => {
    const version = (color: string) => {
      class Swatch extends Component {
        render() {
          return <div>swatch</div>;
        }
      }

      style(Swatch, { color });
      return Swatch;
    };

    const Swatch = version('red');
    hot.accept('react-style', { Swatch });

    const node = render(<Swatch />).container.querySelector('div')!;
    expect(getComputedStyle(node).color).toBe('red');

    await act(async () => void hot.accept('react-style', { Swatch: version('blue') }));
    expect(getComputedStyle(node).color).toBe('blue');
  });

  it('will fast refresh a function component and keep its state', async () => {
    const version = (label: string, color: string) => {
      function Counter() {
        const [count] = useState(() => Math.random());
        return <p _count data-count={count}>{label}</p>;
      }

      style(Counter, { _count: { color } });
      return Counter;
    };

    const Before = version('before', 'red');
    Refresh.register(Before, 'Counter');
    refresh(Before, 'Counter', Refresh.register);

    function Page() {
      return <section><Before /></section>;
    }

    const view = render(<Page />);
    const first = view.container.querySelector('p')!.dataset.count;

    const After = version('after', 'blue');
    Refresh.register(After, 'Counter');
    refresh(After, 'Counter', Refresh.register);
    await act(async () => void Refresh.performReactRefresh());

    const node = view.container.querySelector('p')!;
    expect(node.textContent).toBe('after');
    expect(node.dataset.count).toBe(first);
    expect(getComputedStyle(node).color).toBe('blue');
  });
});

function onServer<T>(fn: () => T): T {
  const saved = (globalThis as any).window;
  delete (globalThis as any).window;
  try {
    return fn();
  } finally {
    (globalThis as any).window = saved;
  }
}

async function onServerAsync<T>(fn: () => Promise<T>): Promise<T> {
  const saved = (globalThis as any).window;
  delete (globalThis as any).window;
  try {
    return await fn();
  } finally {
    (globalThis as any).window = saved;
  }
}

describe('ssr probes', () => {
  it('will emit precedence styles with renderToString', () => {
    class Note extends Component {
      render() {
        return <p _note>note</p>;
      }
    }

    style(Note, { _note: { color: 'green', ':hover': { color: 'red' } } });

    const html = onServer(() => renderToString(<div><Note /><Note /></div>));

    process.stdout.write('\nTOSTRING ' + html + '\n');
    expect(html).toContain('class="Note_note Note_note-hover"');
    expect(html).toContain('ex-Note_note');
  });

  it('will hoist styles into head when streaming a document', async () => {
    function Card() {
      return <section _card>card</section>;
    }

    style(Card, { _card: { padding: '4px' } });

    const html = await onServerAsync(async () => {
      const stream = await renderToReadableStream(
        <html><head><title>t</title></head><body><Card /></body></html>
      );
      await stream.allReady;
      return new Response(stream).text();
    });

    process.stdout.write('\nSTREAM ' + html + '\n');
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain('Card_card');
    expect(html).toContain('class="Card_card"');
  });

  it('will keep caller rules after callee bases across style tags', () => {
    function IconButton() {
      return <button>i</button>;
    }

    function TextButton() {
      return <button>t</button>;
    }

    style(IconButton, { color: 'blue' });
    style(TextButton, { color: 'blue' });

    function Bar() {
      return <nav><IconButton _accent /><TextButton _accent /></nav>;
    }

    style(Bar, { _accent: { color: 'red' } });

    const html = onServer(() => renderToString(<Bar />));
    const order = [...html.matchAll(/data-href="([^"]+)"/g)].flatMap((match) => match[1].split(' ')).map((href) => href.slice(3));
    process.stdout.write('\nTAGS ' + html.slice(0, html.indexOf('<nav')) + '\n');

    process.stdout.write('\nORDER ' + order.join(' ') + '\n');
    expect(order.indexOf('Bar_accent-d1')).toBeGreaterThan(order.indexOf('TextButton'));
    expect(order.indexOf('Bar_accent-d1')).toBeGreaterThan(order.indexOf('IconButton'));
  });

  it('will hydrate without mismatch', async () => {
    class Hydrated extends Component {
      render() {
        return <main _shell><p _note>hi</p></main>;
      }
    }

    style(Hydrated, { _shell: { padding: '2px' }, _note: { color: 'green' } });

    const html = onServer(() => renderToString(<Hydrated />));
    const container = document.body.appendChild(document.createElement('div'));
    container.innerHTML = html;

    await act(async () => void hydrateRoot(container, <Hydrated />));

    expect(container.querySelector('p')!.className).toBe('Hydrated_note');
    expect(getComputedStyle(container.querySelector('p')!).color).toBe('green');
  });

  it('will server render pack variables and macros', () => {
    class Brand extends Css {
      $tone = 'teal';
    }

    const css = Brand.use();

    function Tile() {
      return <div _tile>t</div>;
    }

    css(Tile, ($) => ({ _tile: { color: $.tone, padding: 8, size: 10 } }));

    const html = onServer(() => renderToString(<Tile />));

    process.stdout.write('\nPACK ' + html + '\n');
    expect(html).toContain('--tone: teal');
    expect(html).toMatch(/padding: 8px/);
  });

  it('will stream styles for a late Suspense boundary', async () => {
    let resolve!: (value: string) => void;
    const data = new Promise<string>((done) => (resolve = done));

    function Late() {
      return <em _late>{use(data)}</em>;
    }

    style(Late, { _late: { color: 'purple' } });

    const html = await onServerAsync(async () => {
      const stream = await renderToReadableStream(
        <html><head /><body><Suspense fallback={<i>…</i>}><Late /></Suspense></body></html>
      );
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let text = decoder.decode((await reader.read()).value);
      expect(text).not.toContain('Late_late');
      resolve('done');
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) text += decoder.decode(chunk.value);
      return text;
    });

    process.stdout.write('\nLATE ' + html + '\n');
    expect(html).toContain('Late_late');
    expect(html).toContain('color: purple');
  });
});

describe('hmr probes', () => {
  it('will remount when hooks change across a refresh', async () => {
    function Before() {
      const [value] = useState('a');
      return <p _value>{value}</p>;
    }

    function After() {
      const [value] = useState('a');
      const upper = useMemo(() => value.toUpperCase(), [value]);
      return <p _value>{upper}</p>;
    }

    style(Before, { _value: { color: 'red' } });
    style(After, { _value: { color: 'blue' } });

    Refresh.register(Before, 'Hooks');
    Refresh.setSignature(Before, 'useState{a}');
    refresh(Before, 'Hooks', Refresh.register);
    Refresh.setSignature(wrap(Before), 'useState{a}');

    const view = render(<section><Before /></section>);

    Refresh.register(After, 'Hooks');
    Refresh.setSignature(After, 'useState{a} useMemo{upper}');
    refresh(After, 'Hooks', Refresh.register);
    Refresh.setSignature(wrap(After), 'useState{a} useMemo{upper}');
    await act(async () => void Refresh.performReactRefresh());

    expect(view.container.textContent).toBe('A');
  });
});

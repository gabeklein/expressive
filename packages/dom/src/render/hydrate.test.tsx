import { describe, expect, it, vi } from 'vitest';

import { Component, set } from '@expressive/mvc';

import { hydrate, Portal, render, style } from '../index';
import { renderToString } from '../server';
import { adoptRange, hydrating } from './hydrate';
import { flushMicrotasks, mockPromise } from '../../test.setup';

async function served(node: () => any) {
  const { html } = await renderToString(node());
  const root = document.body.appendChild(document.createElement('main'));

  root.innerHTML = html;
  return root;
}

function rendered(node: any) {
  const root = document.createElement('main');
  const unmount = render(node, root);
  const html = root.innerHTML;

  unmount();
  return html;
}

describe('hydrate', () => {
  it('will adopt the server markup in place and bring it to life', async () => {
    class Counter extends Component {
      count = 0;

      render() {
        const { count, is } = this;

        return (
          <section>
            <h1 title="count">Count is {count}</h1>
            <button onClick={() => is.count++}>{''}add</button>
            {[<i key="a">a</i>, <i key="b">b</i>]}
          </section>
        );
      }
    }

    style(Counter, { _h1: { color: 'red' } });

    const root = await served(() => <Counter />);
    const before = root.innerHTML;
    const heading = root.querySelector('h1')!;
    const text = heading.firstChild!;
    const unmount = hydrate(<Counter />, root);

    expect(root.innerHTML).toBe(before);
    expect(root.querySelector('h1')).toBe(heading);
    expect(heading.firstChild).toBe(text);
    expect(heading.className).toBe('Counter_h1');

    root.querySelector('button')!.click();
    await flushMicrotasks();

    expect(heading.textContent).toBe('Count is 1');
    expect(root.querySelector('h1')).toBe(heading);

    unmount();
    expect(root.innerHTML).toBe('');
  });

  it('will replace what differs and drop markup the client does not render', async () => {
    const root = await served(() => (
      <div>
        <p>old</p>
        <b>stale</b>
        tail
      </div>
    ));
    const paragraph = root.querySelector('p')!;
    const client = (
      <div>
        <p>new</p>
        <span>{''}fresh</span>
      </div>
    );

    hydrate(client, root);

    expect(root.innerHTML).toBe(rendered(client));
    expect(root.querySelector('p')).toBe(paragraph);
  });

  it('will keep a suspended subtree on screen, then adopt it once it renders', async () => {
    const data = mockPromise<string>();

    class Post extends Component {
      body = set(() => data);

      render() {
        return <article>{this.body}</article>;
      }
    }

    class Page extends Component {
      fallback = <p>loading</p>;

      render() {
        return <main><Post /></main>;
      }
    }

    const root = document.body.appendChild(document.createElement('div'));
    root.innerHTML = '<!--fragment--><!--component--><main><!--component--><article>hello</article><!--/component--></main><!--/component--><!--/fragment-->';

    const article = root.querySelector('article')!;

    hydrate(<Page />, root);
    await flushMicrotasks();

    expect(root.textContent).toBe('hello');
    expect(root.querySelector('article')).toBe(article);

    data.resolve('hello');
    await flushMicrotasks();

    expect(root.querySelector('article')).toBe(article);
    expect(root.innerHTML).toContain('<article>hello</article>');
    expect(root.textContent).toBe('hello');
  });

  it('will keep suspended markup without any boundary, and drop what no longer renders after', async () => {
    const data = mockPromise<string>();

    class Lazy extends Component {
      value = set(() => data);

      render() {
        return <b>{this.value}</b>;
      }
    }

    const root = document.body.appendChild(document.createElement('div'));
    root.innerHTML = '<!--fragment--><!--component--><b>ok</b><i>gone</i><!--/component--><!--/fragment-->';

    hydrate(<Lazy />, root);
    expect(root.textContent).toBe('okgone');

    data.resolve('ok');
    await flushMicrotasks();

    expect(root.innerHTML).toBe('<!--fragment--><!--component--><b>ok</b><!--/component--><!--/fragment-->');
  });

  it('will adopt portal markers and hoist head elements fresh', async () => {
    const node = () => (
      <div>
        <title>Hydrated</title>
        <Portal into="body"><aside>away</aside></Portal>
      </div>
    );
    const root = await served(node);
    const markers = [...root.querySelector('div')!.childNodes];

    const unmount = hydrate(node(), root);

    expect([...root.querySelector('div')!.childNodes]).toEqual(markers);
    expect(document.title).toBe('Hydrated');
    expect(document.body.lastElementChild!.textContent).toBe('away');

    unmount();
  });

  it('will mend a range of another kind without sharing its end', async () => {
    const Fn = () => <p>fn</p>;

    class Child extends Component {
      render() {
        return <p>child</p>;
      }
    }

    let client = false;

    class App extends Component {
      show = true;

      render() {
        return this.show ? client ? <Child /> : <Fn /> : <i>none</i>;
      }
    }

    let app!: App;
    const root = await served(() => <App />);

    client = true;
    hydrate(<App is={(x: App) => { app = x; }} />, root);
    expect(root.innerHTML).toBe(rendered(<App />));

    app.show = false;
    await flushMicrotasks();
    expect(root.innerHTML).toBe('<!--fragment--><!--component--><i>none</i><!--/component--><!--/fragment-->');
  });

  it('will not claim past a resumed range, and show a fallback for one the server lacked', async () => {
    const data = mockPromise<string>();

    class Widget extends Component {
      value = set(() => data);
      fallback = <i>wait</i>;

      render() {
        return <div>{this.value}</div>;
      }
    }

    let client = false;
    const node = () => <main>{client && <Widget />}<div>footer</div></main>;
    const root = await served(node);
    const footer = root.querySelector('div')!;

    client = true;
    hydrate(node(), root);
    expect(root.textContent).toBe('waitfooter');

    data.resolve('widget');
    await flushMicrotasks();
    expect(root.innerHTML).toBe('<!--fragment--><main><!--component--><div>widget</div><!--/component--><div>footer</div></main><!--/fragment-->');
    expect(root.querySelectorAll('div')[1]).toBe(footer);
  });

  it('will clear a kept range that resolves to nothing', async () => {
    const data = mockPromise<null>();

    class Widget extends Component {
      value = set(() => data);

      render() {
        return this.value;
      }
    }

    const root = document.body.appendChild(document.createElement('main'));

    root.innerHTML = '<!--fragment--><!--component--><b>stale</b><!--/component--><!--/fragment-->';
    hydrate(<Widget />, root);
    expect(root.textContent).toBe('stale');

    data.resolve(null);
    await flushMicrotasks();
    expect(root.innerHTML).toBe('<!--fragment--><!--component--><!--/component--><!--/fragment-->');
  });

  it('will show a catch fallback for a render that fails on the client', async () => {
    let fail = false;

    class Profile extends Component {
      render() {
        if (fail) throw new Error('boom');
        return <p>a</p>;
      }
    }

    class Page extends Component {
      fallback = <i>oops</i>;

      catch() {
        return new Promise<void>(() => {});
      }

      render() {
        return <Profile />;
      }
    }

    const root = await served(() => <Page />);

    fail = true;
    hydrate(<Page />, root);
    expect(root.textContent).toBe('oops');
  });

  it('will keep a portal into the hydrated root working', async () => {
    class App extends Component {
      items = ['a'];

      render() {
        return (
          <section>
            <div id="modal" />
            <Portal into="#modal">{this.items.map((item) => <i key={item}>{item}</i>)}</Portal>
          </section>
        );
      }
    }

    let app!: App;
    const root = await served(() => <App />);

    hydrate(<App is={(x: App) => { app = x; }} />, root);
    expect(root.querySelector('#modal')!.textContent).toBe('a');

    app.items = ['a', 'b'];
    await flushMicrotasks();
    expect(root.querySelector('#modal')!.textContent).toBe('ab');
  });

  it('will drop server children and attributes the client does not render', () => {
    const root = document.body.appendChild(document.createElement('main'));

    root.innerHTML = '<!--fragment--><ul class="stale" title="x" style="color: red;"><li>a</li></ul><!--/fragment-->';
    hydrate(<ul data-n={1}>{[]}</ul>, root);
    expect(root.innerHTML).toBe('<!--fragment--><ul data-n="1"></ul><!--/fragment-->');
  });

  it('will not rewrite matching attributes or move focus', async () => {
    const node = () => <><img src="/a.png" /><input autoFocus /><input /></>;
    const root = await served(node);
    const image = root.querySelector('img')!;
    const other = root.querySelectorAll('input')[1];
    const write = vi.spyOn(image, 'src', 'set');

    other.focus();
    hydrate(node(), root);

    expect(write).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(other);
  });

  it('will keep text a textarea or raw markup carries, and a default value', async () => {
    const node = () => (
      <form>
        <textarea defaultValue="typed" />
        <div dangerouslySetInnerHTML={{ __html: '<b>raw</b>' }} />
        <input defaultValue="x" />
      </form>
    );
    const root = await served(node);

    hydrate(node(), root);
    expect(root.querySelector('textarea')!.value).toBe('typed');
    expect(root.querySelector('div')!.innerHTML).toBe('<b>raw</b>');
    expect(root.querySelector('input')!.getAttribute('value')).toBe('x');
  });

  it('will not close a range on the end of the one resuming around it', () => {
    const root = document.createElement('div');

    root.innerHTML = '<!--component--><!--component--><!--/component-->';

    const [from, , to] = [...root.childNodes];
    const [, end] = hydrating(root, () => adoptRange(root, to, 'component'), from, to);

    expect(end).not.toBe(to);
  });

  it('will adopt inlined markup, keeping only its own inline style', async () => {
    function Box() {
      return <p style={{ marginTop: 2 }}>box</p>;
    }

    style(Box, { color: 'red' });

    const { html } = await renderToString(<Box />, { inline: true });
    const root = document.body.appendChild(document.createElement('main'));

    root.innerHTML = html;

    const box = root.querySelector('p')!;

    expect(box.getAttribute('style')).toBe('color: red; margin-top: 2px;');

    hydrate(<Box />, root);
    expect(root.querySelector('p')).toBe(box);
    expect(box.className).toBe('Box');
    expect(box.getAttribute('style')).toBe('margin-top: 2px;');
  });

  it('will keep server markup through a second suspension on resume', async () => {
    const first = mockPromise<string>();
    const second = mockPromise<string>();

    class Pair extends Component {
      a = set(() => first);
      b = set(() => second);

      render() {
        return <b>{this.a}{this.b}</b>;
      }
    }

    const root = document.body.appendChild(document.createElement('main'));

    root.innerHTML = '<!--fragment--><!--component--><b>xy</b><!--/component--><!--/fragment-->';

    const bold = root.querySelector('b')!;

    hydrate(<Pair />, root);

    first.resolve('x');
    await flushMicrotasks();
    expect(root.querySelector('b')).toBe(bold);
    expect(bold.textContent).toBe('xy');

    second.resolve('y');
    await flushMicrotasks();
    expect(root.querySelector('b')).toBe(bold);
    expect(bold.textContent).toBe('xy');
  });

  it('will keep nodes a ref adds while hydrating', async () => {
    const node = () => <section ref={(el) => { el?.appendChild(document.createElement('canvas')); }} />;
    const root = await served(node);

    hydrate(node(), root);
    expect(root.querySelector('section > canvas')).not.toBeNull();
  });

  it('will replace an interpolated title and wait for a stylesheet to load', async () => {
    const node = () => <div><title>Post {3} | Site</title><link rel="stylesheet" href="data:text/css," /></div>;
    const { head, html } = await renderToString(node());
    const root = document.body.appendChild(document.createElement('main'));

    document.head.insertAdjacentHTML('afterbegin', head);
    root.innerHTML = html;

    const unmount = hydrate(node(), root);

    expect(document.head.querySelectorAll('title').length).toBe(1);
    expect(document.title).toBe('Post 3 | Site');

    const links = document.head.querySelectorAll('link[rel=stylesheet]');

    expect(links.length).toBe(2);
    links[1].dispatchEvent(new Event('load'));
    expect(document.head.querySelectorAll('link[rel=stylesheet]').length).toBe(1);

    unmount();
    expect(document.head.querySelector('title, link[rel=stylesheet]')).toBeNull();
  });

  it('will keep the option a server select marked', async () => {
    const node = () => <select {...{ defaultValue: 'b' } as any}><option>a</option><option>b</option></select>;
    const root = await served(node);
    const select = root.querySelector('select')!;

    expect(select.value).toBe('b');
    hydrate(node(), root);
    expect(select.value).toBe('b');
  });

  it('will replace the server copy of a head element', async () => {
    const node = () => <div><title>Page</title><meta name="description" content="about" /></div>;
    const { head, html } = await renderToString(node());
    const root = document.body.appendChild(document.createElement('main'));

    document.head.insertAdjacentHTML('afterbegin', head);
    root.innerHTML = html;

    const unmount = hydrate(node(), root);

    expect(document.head.querySelectorAll('title, meta[name=description]').length).toBe(2);
    expect(document.title).toBe('Page');

    unmount();
    expect(document.head.querySelector('title, meta[name=description]')).toBeNull();
  });

  it('will mend markup missing a closing marker or holding a foreign one', () => {
    const root = document.body.appendChild(document.createElement('div'));
    const client = <>{<p>one</p>}</>;

    root.innerHTML = '<!--fragment--><!--fragment--><p>one</p>';
    const unmount = hydrate(client, root);
    expect(root.innerHTML).toBe(rendered(client));
    unmount();

    root.innerHTML = '<!--fragment--><!--fragment--><p>one</p><!--/component--><!--/fragment-->';
    hydrate(client, root);
    expect(root.innerHTML).toBe(rendered(client));
  });
});

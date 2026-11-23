import { describe, expect, it, vi } from 'vitest';
import { renderToString } from './server';

import { Component } from '@expressive/mvc';
import { Portal, render, hydrate } from './index';
import { flushMicrotasks, lazy, mockPromise, mount } from '../test.setup';


describe('portal targets', () => {
  it('will resolve a selector target once and move when it changes', async () => {
    const first = document.createElement('aside');
    const second = document.createElement('aside');
    const query = vi.spyOn(document, 'querySelectorAll');

    first.id = 'first';
    second.className = 'second';
    document.body.append(first, second);

    class Modal extends Component {
      message = 'open';
      target = '#first';

      render() {
        return <Portal into={this.target}><b>{this.message}</b></Portal>;
      }
    }

    const [modal, , release] = mount(Modal);

    expect(first.textContent).toBe('open');

    modal.message = 'still';
    await flushMicrotasks();
    expect(first.textContent).toBe('still');
    expect(query).toBeCalledTimes(1);

    modal.target = '.second';
    await flushMicrotasks();
    expect(first.textContent).toBe('');
    expect(second.textContent).toBe('still');
    expect(query).toBeCalledTimes(2);

    release();
    query.mockRestore();
    first.remove();
    second.remove();
  });

  it('will resolve a selector target rendered beside it off-document', async () => {
    const loaded = mockPromise<() => Component.Node>();
    const Lazy = () => loaded;

    class Page extends Component {
      fallback = <i>wait</i>;

      render() {
        return <Lazy />;
      }
    }

    const root = document.createElement('main');
    document.body.append(root);
    render(<Page />, root);

    loaded.resolve(() => <><div id="slot" /><Portal into="#slot"><b>moved</b></Portal></>);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(root.querySelector('#slot')!.textContent).toBe('moved');
    root.remove();
  });

  it('will throw if a selector target is missing or ambiguous', () => {
    const one = document.createElement('i');
    const two = document.createElement('i');

    one.className = two.className = 'many';
    document.body.append(one, two);

    expect(() => render(<Portal into="#none">x</Portal>, document.createElement('main')))
      .toThrow('Portal target "#none" was not found.');
    expect(() => render(<Portal into=".many">x</Portal>, document.createElement('main')))
      .toThrow('Portal target ".many" is ambiguous.');

    one.remove();
    two.remove();
  });
});


describe('head elements', () => {
  it('will hoist a title ahead of the document title, and restore it on unmount', async () => {
    const shell = document.createElement('title');
    shell.textContent = 'Shell';
    document.head.append(shell);

    class Page extends Component {
      name = 'One';
      order = ['a', 'b'];

      render() {
        return (
          <main>
            {this.order.map((key) => <p key={key}>{key}</p>)}
            <title key="t">{`Page ${this.name}`}</title>
          </main>
        );
      }
    }

    const [page, root, release] = mount(Page);

    expect(document.title).toBe('Page One');
    expect(root.innerHTML).toContain('<main><p>a</p><p>b</p><!--portal--></main>');

    page.name = 'Two';
    page.order = ['b', 'a'];
    await flushMicrotasks();
    expect(document.title).toBe('Page Two');
    expect(root.querySelector('title')).toBeNull();

    release();
    expect(document.title).toBe('Shell');
    shell.remove();
  });

  it('will let the latest title win, and append meta and link', () => {
    const unmount = render(
      <div>
        <title>Outer</title>
        <section><title>Inner</title></section>
        <meta name="description" content="about" />
        <link rel="canonical" href="/x" />
      </div>,
      document.body.appendChild(document.createElement('main'))
    );

    expect(document.title).toBe('Inner');
    expect(document.head.querySelector('meta[name=description]')!.getAttribute('content')).toBe('about');
    expect(document.head.lastElementChild!.outerHTML).toBe('<link rel="canonical" href="/x">');

    unmount();
    expect(document.head.querySelector('meta[name=description], link[rel=canonical], title')).toBeNull();
  });

  it('will let the newest title win as titles mount and unmount in any order', async () => {
    class Titles extends Component {
      shown = ['A', 'B'];

      render() {
        return <div>{this.shown.map((name) => <title key={name}>{name}</title>)}</div>;
      }
    }

    const [titles, , release] = mount(Titles);

    expect(document.title).toBe('B');

    for (const [shown, title] of [[['B'], 'B'], [['B', 'A'], 'A'], [['A'], 'A']] as const) {
      titles.shown = [...shown];
      await flushMicrotasks();
      expect(document.title).toBe(title);
    }

    release();
  });

  it('will keep a title ahead after its boundary suspends and reveals', async () => {
    const shell = document.createElement('title');
    const [Lazy, loaded] = lazy<{ default: () => Component.Node }>();

    shell.textContent = 'Shell';
    document.head.append(shell);

    class Page extends Component {
      show = false;
      fallback = <i>wait</i>;

      render() {
        return <><title>Page</title>{this.show && <Lazy />}</>;
      }
    }

    const [page, root, release] = mount(Page);

    expect(document.title).toBe('Page');

    page.show = true;
    await flushMicrotasks();
    expect(root.textContent).toBe('wait');

    loaded.resolve({ default: () => <b>ready</b> });
    await flushMicrotasks();
    expect(root.textContent).toBe('ready');
    expect(document.title).toBe('Page');

    release();
    shell.remove();
  });

  it('will move a slot ahead when it switches from meta to title', async () => {
    const shell = document.createElement('title');

    shell.textContent = 'Shell';
    document.head.append(shell);

    class Slot extends Component {
      titled = false;

      render() {
        return <div>{this.titled ? <title>Page</title> : <meta name="x" content="y" />}</div>;
      }
    }

    const [slot, , release] = mount(Slot);

    expect(document.title).toBe('Shell');

    slot.titled = true;
    await flushMicrotasks();
    expect(document.title).toBe('Page');

    slot.titled = false;
    await flushMicrotasks();
    expect(document.head.querySelector('meta[name=x]')).not.toBeNull();
    expect(document.title).toBe('Shell');

    release();
    shell.remove();
  });

  it('will keep head elements in a head element it renders', () => {
    const root = document.body.appendChild(document.createElement('main'));
    const unmount = render(<head><title>Inner</title></head>, root);

    expect(root.querySelector('head > title')!.textContent).toBe('Inner');
    unmount();
  });

  it('will keep microdata and shadow root elements in place', () => {
    const root = document.body.appendChild(document.createElement('main'));
    const unmount = render(
      <div itemScope itemType="https://schema.org/Product" itemID="p1">
        <meta itemProp="price" content="9" />
      </div>,
      root
    );

    expect(root.innerHTML).toContain(
      '<div itemscope="" itemtype="https://schema.org/Product" itemid="p1"><meta itemprop="price" content="9"></div>'
    );
    unmount();

    const shadow = document.body.appendChild(document.createElement('div')).attachShadow({ mode: 'open' });
    const release = render(<link rel="stylesheet" href="/x.css" />, shadow);

    expect(shadow.innerHTML).toContain('<link rel="stylesheet" href="/x.css">');
    release();
  });

  it('will keep an svg title in place, but not one in foreignObject', () => {
    const root = document.body.appendChild(document.createElement('main'));
    const unmount = render(<svg><title>icon</title><foreignObject><title>page</title></foreignObject></svg>, root);

    expect(root.querySelector('svg > title')!.textContent).toBe('icon');
    expect(document.title).toBe('page');
    unmount();
  });
});


describe('documents', () => {
  it('will build in the container\'s document, not the global one', async () => {
    const other = document.implementation.createHTMLDocument();
    const root = other.createElement('main');
    const modal = other.createElement('aside');
    const served = other.createElement('main');
    const loading = mockPromise<void>();

    modal.id = 'modal';
    other.body.append(root, modal, served);

    let waiting = true;

    function Slow() {
      if (waiting) throw loading;
      return <i>done</i>;
    }

    class Box extends Component {
      fallback = <b>wait</b>;
    }

    const page = () => <section>text<svg><circle /></svg></section>;

    served.innerHTML = (await renderToString(page())).html;

    const spies = (['createElement', 'createElementNS', 'createTextNode', 'createComment', 'createDocumentFragment'] as const)
      .map((method) => vi.spyOn(document, method));

    try {
      const release = render(
        <section>
          text
          <svg><circle /></svg>
          <Box>
            <Portal into="#modal"><u>modal</u></Portal>
            <Slow />
          </Box>
        </section>,
        root
      );

      expect(root.textContent).toContain('wait');
      expect(modal.textContent).toBe('');

      waiting = false;
      loading.resolve();
      await vi.waitFor(() => expect(root.textContent).toContain('done'));

      expect(modal.textContent).toBe('modal');
      expect(root.querySelector('circle')!.namespaceURI).toBe('http://www.w3.org/2000/svg');

      const unhydrate = hydrate(<>{page()}<p>more</p></>, served);

      expect(served.querySelector('circle')!.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(served.querySelector('p')!.textContent).toBe('more');
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();

      release();
      unhydrate();
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
});

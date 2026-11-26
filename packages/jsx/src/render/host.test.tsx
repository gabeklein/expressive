import { describe, expect, it, vi } from 'vitest';

import { Component, pending } from '@expressive/mvc';

import { PORTAL, Portal, vnode } from '../node/vnode';
import { isComment, plain } from './host';
import type { Host, Hydration } from './host';
import { LEAD } from './portal';
import { hydrate, mountRoot, render } from './render';
import { hostOf } from './suspense';
import { flushMicrotasks, lazy, mockPromise, mount, until } from '../../test.setup';

describe('plain host', () => {
  it('will render tags, text and components with attributes and handlers', async () => {
    const click = vi.fn();
    let card!: Card;

    class Card extends Component {
      title = 'one';
      flag = true;

      render() {
        return <b data-title={this.title} hidden={this.flag} onClick={this.flag ? click : undefined}>{this.title}</b>;
      }
    }

    const root = document.createElement('main');
    const release = mountRoot(<section className="ignored-alias"><Card is={(value) => void (card = value)} /></section>, root, plain);
    const b = root.querySelector('b')!;

    expect(root.querySelector('section')!.getAttribute('className')).toBe('ignored-alias');
    expect(b.getAttribute('data-title')).toBe('one');
    expect(b.hasAttribute('hidden')).toBe(true);

    b.click();
    expect(click).toHaveBeenCalledTimes(1);

    card.title = 'two';
    card.flag = false;
    await flushMicrotasks();

    expect(b.textContent).toBe('two');
    expect(b.hasAttribute('hidden')).toBe(false);

    b.click();
    expect(click).toHaveBeenCalledTimes(1);

    card.flag = true;
    await flushMicrotasks();
    release();

    b.click();
    expect(click).toHaveBeenCalledTimes(1);
    expect(root.childNodes.length).toBe(0);
  });

  it('will skip props it cannot write as attributes, and portal only into a node', () => {
    const root = document.createElement('main');
    const modal = document.createElement('aside');

    modal.id = 'plain-modal';
    document.body.append(root, modal);

    const release = mountRoot(
      <>
        <i ref={() => {}} style={{ color: 'red' }} onClick={'nope' as never} title="kept" />
        <Portal into={modal}><u>away</u></Portal>
      </>,
      root,
      plain
    );

    const i = root.querySelector('i')!;

    expect(i.getAttributeNames()).toEqual(['title']);
    expect(modal.innerHTML).toBe('<!--portal-root--><u>away</u><!--/portal-root-->');
    expect(document.head.querySelector('style[data-expressive]')).toBeNull();

    release();

    expect(() => mountRoot(<Portal into="#plain-modal">x</Portal>, root, plain)).toThrow(
      'Portal target "#plain-modal" needs a node - this host resolves no selectors.'
    );

    root.remove();
    modal.remove();
  });

  it('will render, not hydrate, without a hydration', () => {
    const root = document.createElement('main');
    const aside = document.createElement('aside');

    root.innerHTML = '<p>stale</p>';

    const release = hydrate(<>
      <p>fresh</p>
      {vnode(PORTAL, { into: aside, children: <i>first</i>, [LEAD]: true })}
    </>, root, plain);

    expect(root.textContent).toBe('fresh');
    expect(aside.textContent).toBe('first');
    release();
  });

  it('will move portal content when it starts or stops leading, and remount for a new target', async () => {
    const aside = document.createElement('aside');
    const other = document.createElement('aside');

    class Spot extends Component {
      lead = false;
      into: Element = aside;

      render() {
        return vnode(PORTAL, { into: this.into, children: <i>in</i>, ...(this.lead ? { [LEAD]: true } : {}) });
      }
    }

    aside.append('tail');
    other.append('tail');

    const [spot] = mount(Spot);

    expect(aside.textContent).toBe('tailin');

    spot.lead = true;
    await flushMicrotasks();
    expect(aside.textContent).toBe('intail');

    spot.into = other;
    await flushMicrotasks();
    expect(aside.textContent).toBe('tail');
    expect(other.textContent).toBe('intail');
  });

  it('will resolve the live parent of content mounted while its boundary is hidden, and restore its portals', async () => {
    const aside = document.createElement('aside');
    const parents: globalThis.Node[] = [];
    const gate = mockPromise<void>();
    let ready = false;

    function Slow() {
      if (!ready) throw gate.then(() => ready = true);
      return 'slow';
    }

    class Shell extends Component {
      fallback = 'wait';
      extra = false;

      render() {
        return <>{this.extra && <b>x</b>}<Portal into={aside}><i>in</i></Portal><Slow /></>;
      }
    }

    let shell!: Shell;
    const root = document.createElement('main');
    const hoist = (value: any, parent: globalThis.Node) => (parents.push(hostOf(parent)), value);

    render(<Shell is={(self: Shell) => void (shell = self)} />, root, { ...plain, hoist });
    expect(root.textContent).toBe('wait');
    expect(aside.textContent).toBe('');

    parents.length = 0;
    shell.extra = true;
    await flushMicrotasks();
    expect(parents).toContain(root);

    gate.resolve();
    await flushMicrotasks();
    await flushMicrotasks();
    expect(root.textContent).toBe('xslow');
    expect(aside.textContent).toBe('in');
  });

  it('will keep one listener on an element patched again after its children suspend', async () => {
    const [Lazy, loaded] = lazy();
    let clicks = 0;

    class App extends Component {
      open = false;

      render() {
        return <button onClick={() => clicks++}>{this.open && <Lazy />}</button>;
      }
    }

    const [app, root] = mount(App);

    pending(() => (app.open = true));
    loaded.resolve(() => <s>lazy</s>);
    await until(() => expect(root.textContent).toBe('lazy'));

    root.querySelector('button')!.click();
    expect(clicks).toBe(1);
  });

  it('will recognize a comment by its text', () => {
    expect(isComment(document.createComment('portal'), 'portal')).toBe(true);
    expect(isComment(document.createComment('other'), 'portal')).toBe(false);
    expect(isComment(document.createTextNode('portal'), 'portal')).toBe(false);
  });

  it('will ask the host to locate a string target, and tell it once a portal mounts', () => {
    const root = document.createElement('main');
    const aside = document.createElement('aside');
    const locate = vi.fn(() => aside);
    const portaled = vi.fn((fiber: { children: unknown[] }, _adopted: boolean) => fiber.children.length);

    mountRoot(<Portal into="#away"><i>in</i></Portal>, root, { ...plain, locate, portaled });

    expect(locate).toHaveBeenCalledWith('#away', root);
    expect(aside.textContent).toBe('in');
    expect(portaled).toHaveBeenCalledTimes(1);
    expect(portaled.mock.calls[0][1]).toBe(false);
    expect(portaled.mock.results[0].value).toBe(1);
  });

  it('will drive a host hydration through hydrate, keep and resume', async () => {
    const log: string[] = [];
    const loading = mockPromise<void>();
    const root = document.createElement('main');
    const aside = document.createElement('aside');
    let waiting = true;

    const hydration: Hydration = {
      adopt(parent, before, create, match) {
        if (match(document.createComment('portal')) && !match(document.createComment('other'))) log.push('adopt');
        return parent.insertBefore(create(), before);
      },
      adopted: () => false,
      adoptText: (parent, before, value) => parent.insertBefore(document.createTextNode(value), before),
      adoptRange: (parent, before) => [
        parent.insertBefore(document.createComment('start'), before),
        parent.insertBefore(document.createComment('end'), before)
      ],
      aside(work) {
        log.push('aside');
        return work();
      },
      hydrating(_root, work, from) {
        log.push(from ? 'resume' : 'hydrating');
        return work();
      },
      keep() {
        log.push('keep');
        return true;
      },
      reserve() {
        log.push('reserve');
      }
    };

    function Slow() {
      if (waiting) throw loading;
      return 'done';
    }

    class Box extends Component {
      fallback = 'wait';
    }

    hydrate(<><Portal into={aside}>away</Portal><Box><Slow /></Box></>, root, { ...plain, hydration });

    expect(root.textContent).toBe('');

    waiting = false;
    loading.resolve();
    await loading;
    await flushMicrotasks();

    expect(root.textContent).toBe('done');
    expect(log).toEqual(['hydrating', 'adopt', 'reserve', 'aside', 'keep', 'resume']);
  });

  it('will suspend into a fallback and show text', async () => {
    const loading = mockPromise<void>();
    let waiting = true;

    function Slow() {
      if (waiting) throw loading;
      return 'done';
    }

    class Box extends Component {
      fallback = 'wait';
    }

    const root = document.createElement('main');

    mountRoot(<Box><Slow /></Box>, root, plain);
    expect(root.textContent).toBe('wait');

    waiting = false;
    loading.resolve();
    await loading;
    await flushMicrotasks();
    expect(root.textContent).toBe('done');
  });
});

class Item {
  parentNode: Item | null = null;
  childNodes: Item[] = [];

  constructor(public nodeType: number, public nodeValue: string | null = null, public tag = '') {}

  get nextSibling(): Item | null {
    const siblings = this.parentNode?.childNodes;
    return siblings ? siblings[siblings.indexOf(this) + 1] || null : null;
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  insertBefore(node: Item, before: Item | null) {
    if (node.nodeType == 11) {
      for (const child of [...node.childNodes]) this.insertBefore(child, before);
      return node;
    }

    node.remove();
    node.parentNode = this;
    this.childNodes.splice(before ? this.childNodes.indexOf(before) : this.childNodes.length, 0, node);
    return node;
  }

  appendChild(node: Item) {
    return this.insertBefore(node, null);
  }

  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.childNodes;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentNode = null;
  }

  replaceChildren() {
    for (const child of [...this.childNodes]) child.remove();
  }

  getRootNode(): Item {
    return this.parentNode ? this.parentNode.getRootNode() : this;
  }

  toString(): string {
    if (this.nodeType == 3) return this.nodeValue!;
    if (this.nodeType == 8) return '';
    const inner = this.childNodes.join('');
    return this.tag ? `<${this.tag}>${inner}</${this.tag}>` : inner;
  }
}

const tree: Host = {
  text: (_root, value) => new Item(3, value) as never,
  marker: (_root, kind) => new Item(8, kind) as never,
  fragment: () => new Item(11) as never,
  mount: (_fiber, value, parent, before) => (parent as never as Item).insertBefore(new Item(1, null, value.type as string), before as never) as never,
  patch() {},
  unmount: vi.fn()
};

describe('custom host', () => {
  it('will render into a tree that is not the DOM', async () => {
    let list!: List;

    class List extends Component {
      items = ['a', 'b'];

      render() {
        return <ul>{this.items.map((item) => <li key={item}>{item}</li>)}</ul>;
      }
    }

    const root = new Item(1, null, 'root');
    const release = mountRoot(<List is={(value) => void (list = value)} />, root as never, tree);

    expect(String(root)).toBe('<root><ul><li>a</li><li>b</li></ul></root>');

    list.items = ['b', 'c'];
    await flushMicrotasks();
    expect(String(root)).toBe('<root><ul><li>b</li><li>c</li></ul></root>');

    expect(tree.unmount).toHaveBeenCalledTimes(1);

    release();
    expect(String(root)).toBe('<root></root>');
    expect(tree.unmount).toHaveBeenCalledTimes(4);
  });

  it('will hide and reveal through its own fragments', async () => {
    const loading = mockPromise<void>();
    let waiting = true;

    function Slow() {
      if (waiting) throw loading;
      return <b>done</b>;
    }

    class Box extends Component {
      fallback = <i>wait</i>;
    }

    const root = new Item(1, null, 'root');

    mountRoot(<Box><p>kept</p><Slow /></Box>, root as never, tree);
    expect(String(root)).toBe('<root><i>wait</i></root>');

    waiting = false;
    loading.resolve();
    await loading;
    await flushMicrotasks();
    expect(String(root)).toBe('<root><p>kept</p><b>done</b></root>');
  });

  it('will skip children a host sets itself, and settle each element after its children', () => {
    const settled: string[] = [];
    const host: Host = {
      ...tree,
      patch(fiber, value) {
        if (value.props.text == null) return;
        (fiber.start as never as Item).appendChild(new Item(3, value.props.text as string));
        return false;
      },
      settle: (fiber) => void settled.push(String(fiber.start))
    };
    const root = new Item(1, null, 'root');

    mountRoot(<ul><li text="raw">ignored</li><li>kept</li></ul>, root as never, host);

    expect(String(root)).toBe('<root><ul><li>raw</li><li>kept</li></ul></root>');
    expect(settled).toEqual(['<li>raw</li>', '<li>kept</li>', '<ul><li>raw</li><li>kept</li></ul>']);
  });
});

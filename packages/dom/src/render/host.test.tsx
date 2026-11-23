import { describe, expect, it, vi } from 'vitest';

import { Component } from '@expressive/mvc';

import { flushMicrotasks, mockPromise } from '../../test.setup';
import { mountRoot } from './render';
import { limp } from './host';
import type { Host } from './host';
import { complete } from './mount';
import { reconcileChildren } from './reconcile';

describe('limp host', () => {
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
    const release = mountRoot(<section className="ignored-alias"><Card is={(value) => void (card = value)} /></section>, root, limp);
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

    mountRoot(<Box><Slow /></Box>, root, limp);
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
  mount(fiber, value, parent, before) {
    const element = new Item(1, null, value.type as string);

    fiber.start = fiber.end = element as never;
    (parent as never as Item).insertBefore(element, before as never);
    return complete(fiber, () => tree.patch(fiber, value));
  },
  patch(fiber, value) {
    fiber.props = value.props;
    reconcileChildren(fiber, fiber.start, null, value.props.children, fiber.context, fiber.boundary);
  },
  unmount() {}
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

    release();
    expect(String(root)).toBe('<root></root>');
  });
});

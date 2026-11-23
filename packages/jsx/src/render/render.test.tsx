import { describe, expect, it, vi } from 'vitest';

import { Component, Model, set } from '@expressive/mvc';

import { Portal } from '../node/vnode';
import { fragment } from './commits';
import { afterPass, mountRoot, settled } from './render';
import { limp } from './host';
import type { Root } from './host';
import { flushMicrotasks, mockPromise, render } from '../../test.setup';

describe('render', () => {
  it('will replace an existing root and make unmount idempotent', () => {
    const root = document.createElement('main');
    const first = render(<p>one</p>, root);
    const second = render(<p>two</p>, root);

    expect(root.textContent).toBe('two');
    first();
    expect(root.textContent).toBe('two');
    second();
    second();
    expect(root.textContent).toBe('');
  });

  it('will run after the pass, or now outside one', () => {
    const order: string[] = [];

    afterPass(() => order.push('now'));

    function Child() {
      afterPass(() => {
        order.push('after');
        afterPass(() => order.push('during flush'));
      });
      order.push('render');
      return null;
    }

    mountRoot(<Child />, document.createElement('main'), limp);

    expect(order).toEqual(['now', 'render', 'after', 'during flush']);
  });
});

describe('settled', () => {
  function container() {
    return fragment({ host: limp, container: document.body } as Root);
  }

  function text(node: globalThis.Node) {
    return node.textContent;
  }

  it('will wait out suspensions, retrying in place without a fallback', async () => {
    const drawn = vi.fn();
    let ready = false;

    function Spinner() {
      drawn();
      return 'wait';
    }

    function Slow() {
      if (!ready) throw new Promise((resolve) => setTimeout(resolve)).then(() => ready = true);
      return 'done';
    }

    const root = container();
    const unmount = await settled(<Component fallback={<Spinner />}><Slow /></Component>, root, limp);

    expect(text(root)).toBe('done');
    expect(drawn).not.toHaveBeenCalled();
    unmount();
  });

  it('will wait at the root without a boundary, sharing the wait with portals', async () => {
    const into = document.createDocumentFragment();
    let ready = false;

    function Slow() {
      if (!ready) throw new Promise((resolve) => setTimeout(resolve)).then(() => ready = true);
      return 'away';
    }

    const root = container();

    await settled(<Portal into={into}><Slow /></Portal>, root, limp);

    expect(text(into)).toBe('away');
  });

  it('will retry a caught error, then pass one that gets no further to the next boundary', async () => {
    const inner = vi.fn();
    const outer = vi.fn();

    function Always(): any {
      throw new Error('always');
    }

    await expect(settled(
      <Component catch={outer}><Component catch={inner}><Always /></Component></Component>,
      container(),
      limp
    )).rejects.toThrow('always');

    expect(inner).toHaveBeenCalledOnce();
    expect(outer).toHaveBeenCalledOnce();
  });

  it('will keep retrying while a failing render gets further', async () => {
    const failing = new Set(['a', 'b']);
    const caught = vi.fn();

    class Setup extends Component {
      name = '';

      new() {
        if (failing.delete(this.name)) throw new Error(this.name);
      }

      render() {
        return this.name;
      }
    }

    const root = container();

    await settled(<Component catch={caught}><Setup name="a" /><Setup name="b" /></Component>, root, limp);

    expect(caught).toHaveBeenCalledTimes(2);
    expect(text(root)).toBe('ab');
  });

  it('will reject when aborted, unmounting before a pending retry runs', async () => {
    const pending = mockPromise<string>();
    const caught = vi.fn();
    const controller = new AbortController();

    class Slow extends Component {
      value = set(() => pending);

      render() {
        return this.value;
      }
    }

    const rendering = settled(<Component catch={caught}><Slow /></Component>, container(), limp, controller.signal);

    pending.reject(new Error('failed'));
    await flushMicrotasks();
    controller.abort('stop');

    await expect(rendering).rejects.toBe('stop');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(caught).not.toHaveBeenCalled();
  });

  it('will stop waiting on a suspension its tree drops', async () => {
    class Gate extends Model {
      open = true;
    }

    function Never(): any {
      throw new Promise(() => {});
    }

    class Shell extends Component {
      gate = new Gate();

      new() {
        setTimeout(() => this.gate.open = false);
      }

      render() {
        return this.gate.open ? <Never /> : 'closed';
      }
    }

    const root = container();

    await settled(<Shell />, root, limp, AbortSignal.timeout(1000));

    expect(text(root)).toBe('closed');
  });
});

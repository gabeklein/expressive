import { describe, expect, it, vi } from 'vitest';

import { Component } from '@expressive/mvc';

import { Portal, render } from '../index';
import { mockPromise } from '../../test.setup';

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

  it('will build in the container\'s document, not the global one', async () => {
    const other = document.implementation.createHTMLDocument();
    const root = other.createElement('main');
    const modal = other.createElement('aside');
    const loading = mockPromise<void>();
    let waiting = true;

    modal.id = 'modal';
    other.body.append(root, modal);

    const spies = (['createElement', 'createElementNS', 'createTextNode', 'createComment', 'createDocumentFragment'] as const)
      .map((method) => vi.spyOn(document, method));

    function Slow() {
      if (waiting) throw loading;
      return <i>done</i>;
    }

    class Box extends Component {
      fallback = <b>wait</b>;
    }

    const release = render(
      <section>
        text
        <svg><circle /></svg>
        <Portal into="#modal"><u>modal</u></Portal>
        <Box><Slow /></Box>
      </section>,
      root
    );

    expect(root.textContent).toContain('wait');

    waiting = false;
    loading.resolve();
    await loading;
    await vi.waitFor(() => expect(root.textContent).toContain('done'));

    expect(modal.textContent).toBe('modal');
    expect(root.querySelector('circle')!.namespaceURI).toBe('http://www.w3.org/2000/svg');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();

    release();
    spies.forEach((spy) => spy.mockRestore());
  });
});

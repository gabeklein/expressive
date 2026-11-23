import { describe, expect, it, vi } from 'vitest';

import { Component } from '@expressive/mvc';

import { Portal, hydrate, render } from '@expressive/dom';
import { renderToString } from '../server';
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

import { describe, expect, it } from 'vitest';

import { Component } from '@expressive/mvc';

import { Portal } from '../node/vnode';
import { flushMicrotasks, mount } from '../../test.setup';

describe('Portal', () => {
  it('will render and move portal children with logical context', async () => {
    const aside = document.createElement('aside');
    const nextPortal = document.createElement('aside');

    class Modal extends Component {
      message = 'open';
      target = aside;

      render() {
        return <Portal into={this.target}><button>{this.message}</button></Portal>;
      }
    }

    const [modal, root, release] = mount(Modal);

    expect(root.querySelector('button')).toBeNull();
    expect(aside.textContent).toBe('open');

    modal.message = 'closed';
    await flushMicrotasks();
    expect(aside.textContent).toBe('closed');

    modal.target = nextPortal;
    await flushMicrotasks();
    expect(aside.textContent).toBe('');
    expect(nextPortal.textContent).toBe('closed');

    release();
    expect(nextPortal.textContent).toBe('');
  });
});

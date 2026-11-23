import { describe, expect, it } from 'vitest';

import { Component } from '@expressive/mvc';

import { createElement, Portal, render, Style, style } from './index';
import { serialize } from './style';
import { place } from '../test.setup';

describe('serialize', () => {
  it('will keep a var() shorthand beside its longhand', () => {
    expect(serialize(document, { margin: 'var(--gap) 1px', marginTop: '2px' }))
      .toBe('margin: var(--gap) 1px; margin-top: 2px;');
  });

  it('will skip a declaration the CSSOM rejects', () => {
    expect(serialize(document, { color: 'red', width: 'nonsense' })).toBe('color: red;');
  });
});

describe('targets', () => {
  function sheet(root: Document | ShadowRoot) {
    return root.querySelector<HTMLStyleElement>('style[data-expressive=dom]');
  }

  function adopted(root: ShadowRoot) {
    return root.adoptedStyleSheets.flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText));
  }

  function shadow() {
    return document.body.appendChild(document.createElement('div')).attachShadow({ mode: 'open' });
  }

  it('will style a tree rendered into a shadow root', () => {
    const Inside = () => createElement('p', {});

    style(Inside, { color: 'red' });

    const root = shadow();
    render(createElement(Inside, {}), root);

    expect(root.children).toHaveLength(1);
    expect(adopted(root).some((rule) => rule.includes('color: red'))).toBe(true);
    expect(getComputedStyle(root.querySelector('p')!).color).toBe('red');
  });

  it('will style a shadow root whose host is detached', () => {
    const Loose = () => createElement('p', {});

    style(Loose, { color: 'teal' });

    const root = document.createElement('div').attachShadow({ mode: 'open' });
    render(createElement(Loose, {}), root);
    document.body.append(root.host);

    expect(getComputedStyle(root.querySelector('p')!).color).toBe('teal');
  });

  it('will keep a shadow root styled across renders into it', () => {
    const Again = () => createElement('p', {});

    style(Again, { color: 'navy' });

    const root = shadow();
    render(createElement(Again, {}), root);
    render(createElement(Again, {}), root);

    expect(root.adoptedStyleSheets).toHaveLength(1);
    expect(getComputedStyle(root.querySelector('p')!).color).toBe('navy');
  });

  it('will style an update in a shadow root', async () => {
    class Toggle extends Component {
      on = false;

      render() {
        return createElement('p', { _on: this.on });
      }
    }

    style(Toggle, { _on: { color: 'olive' } });

    const root = shadow();
    const [view] = [Toggle.new()];
    render(view, root);
    view.on = true;
    await new Promise((resolve) => setTimeout(resolve));

    expect(getComputedStyle(root.querySelector('p')!).color).toBe('olive');
  });

  it('will style a portal into a shadow root', () => {
    const into = shadow();
    const Ported = () => createElement(Portal, { into, children: createElement('b', {}) });

    style(Ported, { _b: { color: 'blue' } });
    place(createElement(Ported, {}));

    expect(getComputedStyle(into.querySelector('b')!).color).toBe('blue');
  });

  it('will style a tree in another document', () => {
    const other = document.implementation.createHTMLDocument();
    const Away = () => createElement('p', {});

    style(Away, { color: 'green' });
    render(createElement(Away, {}), other.body.appendChild(other.createElement('main')));

    expect(sheet(other)).not.toBeNull();
  });

  it('will write a variable default declared after the sheet opened', () => {
    const Early = () => createElement('i', {});

    style(Early, { color: 'red' });
    place(createElement(Early, {}));

    class Later extends Style {
      readonly $laterHue = 'maroon';
    }

    const later = Later.use();
    const Plain = () => createElement('i', { style: { color: 'var(--later-hue)' } });

    later(Plain, {});

    const node = place(createElement(Plain, {}), document.body.appendChild(document.createElement('main'))).querySelector('i')!;

    expect(getComputedStyle(node).color).toBe('maroon');
  });

  it('will write pack roots for a shadow root into its document', () => {
    class Shaded extends Style {
      readonly $shadeHue = 'purple';
    }

    const Swatch = () => createElement('i', {});

    Shaded.use()(Swatch, ($) => ({ color: $.shadeHue }));

    const root = shadow();
    render(createElement(Swatch, {}), root);

    const written = [...document.head.querySelectorAll('style[data-expressive=root]')].map((element) => element.textContent);

    expect(written.some((text) => text!.includes('--shade-hue'))).toBe(true);
    expect(getComputedStyle(root.querySelector('i')!).color).toBe('purple');

    render(createElement(Swatch, {}), shadow());
    render(createElement(Swatch, {}), document.createElement('main'));

    const again = [...document.head.querySelectorAll('style[data-expressive=root]')].filter((element) => element.textContent!.includes('--shade-hue'));

    expect(again).toHaveLength(1);
  });

  it('will style a fallback a late recovery draws in a shadow root', async () => {
    const Waiting = () => createElement('i', {});

    style(Waiting, { color: 'red' });

    class Inner extends Component {
      catch() {
        return Promise.reject('escalated');
      }

      render(): never {
        throw 'initial';
      }
    }

    class Outer extends Component {
      fallback = createElement(Waiting, {});

      catch() {
        return new Promise<void>(() => {});
      }

      render() {
        return createElement(Inner, {});
      }
    }

    const root = shadow();
    render(createElement(Outer, {}), root);
    await new Promise((resolve) => setTimeout(resolve));

    expect(getComputedStyle(root.querySelector('i')!).color).toBe('red');
  });
});

import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { Component, has, Model } from '@expressive/mvc';

import { vnode } from '../node/vnode';
import { render } from '../../test.setup';

describe('mount', () => {
  it('will reject unsupported render values and element types', () => {
    const root = document.createElement('main');

    expect(() => render({} as never, root)).toThrow('Cannot render a plain object.');
    expect(() => render(Symbol('loose') as never, root)).toThrow('Cannot render Symbol(loose).');
    expect(() => render(vnode(Symbol('unknown'), {}), root)).toThrow('Cannot use Symbol(unknown) as an element type.');
    expect(() => render(vnode(<div /> as never, {}), root)).toThrow('Cannot use an element as an element type.');
    expect(() => render(vnode(null as never, {}), root)).toThrow('Cannot use null as an element type.');
    expect(root.textContent).toBe('');
  });

  it('will name what was rendered and the component it came from', () => {
    class Row {}
    const Loose = () => <div>{Promise.resolve() as never}</div>;
    const Detached = () => new Row() as never;
    const Mistaken = () => Loose as never;
    const Bare = () => Object.create(null);
    const Anonymous = [() => new (class {})() as never][0];
    const Unnamed = () => [() => null][0] as never;

    class Page extends Component {
      render() {
        return <Detached />;
      }
    }

    const root = document.createElement('main');

    expect(() => render(<Loose />, root)).toThrow('Cannot render an instance of Promise in Loose.');
    expect(() => render(<Page />, root)).toThrow('Cannot render an instance of Row in Detached.');
    expect(() => render(<Mistaken />, root)).toThrow('Cannot render function Loose in Mistaken.');
    expect(() => render(<Bare />, root)).toThrow('Cannot render a plain object in Bare.');
    expect(() => render(<Anonymous />, root)).toThrow('Cannot render an instance of an anonymous class in an anonymous component.');
    expect(() => render(<Unnamed />, root)).toThrow('Cannot render an anonymous function in Unnamed.');
  });

  it('will name a portal made by another copy of the package', () => {
    const Portal = () => vnode(Symbol('@expressive/dom.portal'), {});
    const root = document.createElement('main');

    expect(() => render(<Portal />, root)).toThrow(
      'Cannot use a portal from another copy of @expressive/dom as an element type in Portal. Is the package loaded twice?'
    );
  });

  it('will name an element from another registered host', async () => {
    vi.resetModules();

    const runtime = await vi.importActual<typeof import('@expressive/jsx/jsx-runtime')>('@expressive/jsx/jsx-runtime');
    const { render: renderWith } = await vi.importActual<typeof import('./render')>('./render');
    const { limp } = await vi.importActual<typeof import('./host')>('./host');
    const render = (node: any, root: Element) => renderWith(node, root, limp);
    const foreign = { host: true } as never;
    const Page = () => foreign;
    const page = runtime.jsx(Page, {});
    const shared = (globalThis as any)[Symbol.for('@expressive/jsx.registry')];
    const saved = { ...shared.host };

    onTestFinished(() => {
      Object.assign(shared.host, saved);
      shared.registered = undefined;
    });

    runtime.host({
      jsx: () => foreign,
      jsxs: () => foreign,
      childrenOf: (children) => [children as never],
      isElement: (node) => node === foreign,
      propsOf: () => ({}),
      typeOf: () => 'p',
      Fragment: Symbol('host.Fragment')
    });

    expect(() => render(page, document.createElement('main'))).toThrow(
      'Cannot render an element from another JSX host in Page. Is another host adapter, like @expressive/react, imported?'
    );
  });

  it('will name the component rendering a collection of unrenderable values', () => {
    const list = new has.List([{ bad: 1 }] as never[]);
    const Page = () => <ul>{list}</ul>;
    const root = document.createElement('main');

    expect(() => render(<Page />, root)).toThrow('Cannot render a plain object in Page.');
    expect(() => render(list, root)).toThrow('Cannot render a plain object.');
  });

  it('will throw if a Model class is rendered as an element', () => {
    class Bare extends Model {}

    // @ts-expect-error a Model is not a JSX element
    expect(() => render(<Bare />, document.createElement('main'))).toThrow(
      'Bare is a Model - extend Component to render it, or provide it with <Component for={Bare}>.'
    );
  });

  it('will throw if a Model instance is placed inline', () => {
    class Bare extends Model {}
    const bare = Bare.new();

    const Page = () => <div>{bare as never}</div>;

    expect(() => render(<div>{bare as never}</div>, document.createElement('main'))).toThrow(
      'Bare is a Model - extend Component to render it, or provide it with <Component for={Bare}>.'
    );
    expect(() => render(<Page />, document.createElement('main'))).toThrow(
      'Bare in Page is a Model - extend Component to render it, or provide it with <Component for={Bare}>.'
    );
    bare.set(null);
  });
});

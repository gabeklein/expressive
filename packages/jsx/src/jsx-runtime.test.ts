import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { JSX as DomJSX } from '@expressive/dom/jsx-runtime';

import { childrenOf, Fragment, host, isElement, jsx, jsxs, onElement, propsOf, typeOf } from './jsx-runtime';
import { jsxDEV, Fragment as devFragment } from './jsx-dev-runtime';
import * as entry from './jsx-runtime';
import type { HostRuntime, JSX } from './jsx-runtime';
import { isVNode } from './node/vnode';

const HOST_FRAGMENT = Symbol('host.Fragment');

function mockHost(overrides?: Partial<HostRuntime>): HostRuntime {
  return {
    jsx: vi.fn((type, props, key) => ({ kind: 'jsx', type, props, key })),
    jsxs: vi.fn((type, props, key) => ({ kind: 'jsxs', type, props, key })),
    Fragment: HOST_FRAGMENT,
    childrenOf: vi.fn((children) => [children]),
    isElement: vi.fn((node) => !!node),
    typeOf: vi.fn((node: any) => node.type),
    propsOf: vi.fn((node: any) => node.props),
    ...overrides
  };
}

const runtime = mockHost();

describe('unregistered', () => {
  // must run before any host() call in this module
  it('will create and read a default element', () => {
    const node = jsx('div', { a: 1 }, 'k');

    expect(node).toMatchObject({ type: 'div', props: { a: 1 }, key: 'k' });
    expect(isElement(node)).toBe(true);
    expect(isElement({ type: 'div', props: {} })).toBe(false);
    expect(typeOf(node)).toBe('div');
    expect(typeOf('div')).toBeUndefined();
    expect(propsOf(node)).toEqual({ a: 1 });
    expect(propsOf(null)).toEqual({});
    expect(propsOf(jsxs('ul', null as any))).toEqual({});
    expect(typeOf(jsx(Fragment, {}))).toBe(Fragment);
    expect(childrenOf([node, [null, 'x', false], undefined, 0])).toEqual([node, 'x', 0]);
  });

  it('will mark a dev element with its source', () => {
    const source = { fileName: 'App.tsx', lineNumber: 1 };

    expect((jsx('div', {}) as any).source).toBeUndefined();
    expect((jsxDEV('div', {}, undefined, false, source) as any).source).toBe(source);
    expect((jsxDEV('div', {}) as any).source).toEqual({});
  });

  it('will call the element hook, chaining the previous', () => {
    const first = vi.fn();
    const second = vi.fn();

    expect(onElement(first)).toBeUndefined();
    expect(onElement(second)).toBe(first);

    const node = jsx('div', {});

    expect(second).toHaveBeenCalledWith(node);
    expect(first).not.toHaveBeenCalled();
  });

  it('will create renderable elements in development', () => {
    expect(isVNode(jsxDEV('div', {}, undefined, false, {}, null))).toBe(true);
  });

  it('will not register a host on import', async () => {
    vi.resetModules();

    const runtime = await vi.importActual<typeof import('./jsx-runtime')>('./jsx-runtime');

    await vi.importActual('./index');
    await vi.importActual('@expressive/dom/jsx-runtime');

    expect(() => runtime.host({ ...mockHost(), Fragment: null })).not.toThrow();
  });

});

describe('registration', () => {
  it('will register a host', () => {
    host(runtime);
    expect(jsx('div', { a: 1 }, 'k')).toEqual({
      kind: 'jsx', type: 'div', props: { a: 1 }, key: 'k'
    });
  });

  it('will accept same host again but throw on a conflicting one', () => {
    expect(() => host(runtime)).not.toThrow();
    expect(() => host(mockHost())).toThrow(
      'A different JSX host is already registered'
    );
  });
});

describe('runtime', () => {
  it('will delegate jsxs', () => {
    expect(jsxs('ul', { children: [] })).toEqual({
      kind: 'jsxs', type: 'ul', props: { children: [] }, key: undefined
    });
  });

  it('will translate Fragment to host Fragment', () => {
    expect(devFragment).toBe(Fragment);
    expect((jsx(Fragment, {}) as any).type).toBe(HOST_FRAGMENT);
    expect((jsxs(Fragment, {}) as any).type).toBe(HOST_FRAGMENT);
    expect((jsxDEV(Fragment, {}) as any).type).toBe(HOST_FRAGMENT);
  });

  it('will fall back to jsx when host lacks jsxDEV', () => {
    expect(jsxDEV('div', {}, 'k', false)).toEqual({
      kind: 'jsx', type: 'div', props: {}, key: 'k'
    });
    expect(jsxDEV('div', {}, 'k', true)).toEqual({
      kind: 'jsxs', type: 'div', props: {}, key: 'k'
    });
  });

  it('will delegate jsxDEV when host provides it', () => {
    runtime.jsxDEV = vi.fn((type, props, key, isStatic) => ({
      kind: 'jsxDEV', type, props, key, isStatic
    }) as any);
    host(runtime);

    expect(jsxDEV('div', {}, 'k', true)).toEqual({
      kind: 'jsxDEV', type: 'div', props: {}, key: 'k', isStatic: true
    } as any);
  });
});

describe('introspection', () => {
  it('will delegate to host', () => {
    expect(childrenOf('x')).toEqual(['x']);
    expect(isElement(0)).toBe(false);
    expect(isElement({})).toBe(true);
    expect(typeOf({ type: 'div' })).toBe('div');
    expect(propsOf({ props: { to: '/' } })).toEqual({ to: '/' });
    expect(typeOf({ type: HOST_FRAGMENT })).toBe(Fragment);
  });
});

describe('jsx-runtime module', () => {
  it('will carry the transform contract and host seams', () => {
    expect(Object.keys(entry).sort()).toEqual([
      'Fragment', 'childrenOf', 'host', 'isElement',
      'jsx', 'jsxDEV', 'jsxs', 'onElement', 'propsOf', 'typeOf'
    ]);
  });

  it('will accept agnostic element types where a host types them', () => {
    expectTypeOf<JSX.ElementType>().toExtend<DomJSX.ElementType>();
  });
});

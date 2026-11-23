import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  childrenOf,
  Fragment,
  isElement,
  jsx as coreJsx,
  jsxDEV as coreJsxDEV,
  jsxs as coreJsxs,
  propsOf,
  typeOf
} from '@expressive/mvc/jsx-runtime';

import './jsx-runtime';
import type { JSX as DomJSX } from './jsx-runtime';
import type { JSX } from '@expressive/mvc/jsx-runtime';
import { jsxDEV } from './jsx-dev-runtime';
import { isVNode } from './node/vnode';

describe('JSX runtime', () => {
  it('will create and read the default element', () => {
    const child = coreJsx('span', { children: 'one' });
    const node = coreJsxs(Fragment, { children: [child, 'two'] });

    expect(isElement(node)).toBe(true);
    expect(typeOf(node)).toBe(Fragment);
    expect(propsOf(node)).toEqual({ children: [child, 'two'] });
    expect(childrenOf(propsOf(node).children)).toEqual([child, 'two']);
    expect(typeOf('text')).toBeUndefined();
    expect(propsOf('text')).toEqual({});
  });

  it('will expose the development transform entry', () => {
    expect(isVNode(jsxDEV('div', {}, undefined, false, {}, null))).toBe(true);
    expect(isVNode(coreJsxDEV('div', {}, undefined, false))).toBe(true);
  });
});

describe('import', () => {
  it('will not register a host', async () => {
    vi.resetModules();

    const runtime = await vi.importActual<typeof import('@expressive/mvc/jsx-runtime')>('@expressive/mvc/jsx-runtime');

    await vi.importActual('./index');
    await vi.importActual('./jsx-runtime');

    expect(() => runtime.host({ ...runtime, Fragment: null })).not.toThrow();
  });
});

describe('types', () => {
  it('will accept agnostic element types', () => {
    expectTypeOf<JSX.ElementType>().toExtend<DomJSX.ElementType>();
  });
});

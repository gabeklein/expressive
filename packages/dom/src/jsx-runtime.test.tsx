import { describe, expect, expectTypeOf, it } from 'vitest';

import type { JSX as Base } from '@expressive/jsx/jsx-runtime';
import { Model } from '@expressive/mvc';

import type { JSX } from './jsx-runtime';

describe('jsx-runtime', () => {
  it('will not register a host on import', async () => {
    await import('./jsx-runtime');
    await import('./index');

    expect((globalThis as any)[Symbol.for('@expressive/jsx.registry')]?.registered).toBeUndefined();
  });

  it('will accept agnostic element types', () => {
    expectTypeOf<Base.ElementType>().toExtend<JSX.ElementType>();
  });

  it('will type attributes from the component a loader resolves', () => {
    class Settings extends Model {
      theme = 'dark';
    }

    const Fn = (props: { size: number }) => props.size;
    const Lazy = () => Promise.resolve({ default: Fn });
    const LazyModel = () => Promise.resolve(Settings);
    const Arity = (_props: { id: number }) => Promise.resolve(Fn);

    void (() => [
      <Lazy size={1} />,
      <LazyModel theme="light" />,
      // @ts-expect-error
      <LazyModel theme={1} />,
      // @ts-expect-error
      <Arity id={1} />,
      // @ts-expect-error
      <Lazy size="x" />,
      // @ts-expect-error
      <Lazy />
    ]);
  });
});

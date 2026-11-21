import { beforeAll, describe, expect, it, vi } from 'vitest';

let store: typeof import('./store');
let observable: typeof import('./observable');

beforeAll(async () => {
  vi.resetModules();
  observable = await vi.importActual('./observable');
  store = await vi.importActual('./store');
});

function managed<T extends object>(data: T) {
  store.manage(data);
  observable.event(data);

  const updates: unknown[] = [];

  observable.listener(data, (key) => {
    if (typeof key == 'string') updates.push(key);
  });

  return { data, updates };
}

describe('manage', () => {
  it('will manage own values of a plain object', () => {
    const { data, updates } = managed({ foo: 1 });

    data.foo = 2;

    expect(data.foo).toBe(2);
    expect(updates).toEqual(['foo']);
    expect(store.entries(data)).toEqual([['foo', 2]]);
  });

  it('will not manage _ keys or then', () => {
    const { data, updates } = managed({ _foo: 1, then: 2 });

    data._foo = 3;
    data.then = 4;

    expect(data._foo).toBe(3);
    expect(data.then).toBe(4);
    expect(updates).toEqual([]);
    expect(store.entries(data)).toEqual([]);
  });
});

describe('access', () => {
  it('will suspend until a required value is set', async () => {
    const data = {};

    store.apply(data, 'foo', {});
    observable.event(data);

    let thrown: unknown;

    try {
      store.access(data, 'foo', true);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Promise);

    store.update(data, 'foo', 'bar');

    await expect(thrown).resolves.toBe('bar');
  });
});

describe('compute', () => {
  it('will derive from managed values', async () => {
    const { data } = managed({ foo: 1 } as { foo: number; double?: number });

    store.compute(data, 'double', (self: typeof data) => self.foo * 2);

    expect(data.double).toBe(2);

    data.foo = 2;
    await Promise.resolve();

    expect(data.double).toBe(4);
  });
});

describe('values', () => {
  it('will export values, drilling into get()', () => {
    const { data } = managed({ foo: 1, bar: { get: () => 'baz' } });

    expect(store.values(data)).toEqual({ foo: 1, bar: 'baz' });
  });

  it('will omit a value whose get method throws false', () => {
    const bar = { get(): never { throw false; } };
    const { data } = managed({ foo: 1, bar, baz: Object.create(bar) });

    expect(store.values(data)).toEqual({ foo: 1 });
  });

  it('will omit a value whose get getter throws false', () => {
    const bar = { get get(): never { throw false; } };
    const { data } = managed({ foo: 1, bar });

    expect(store.values(data)).toEqual({ foo: 1 });
  });

  it('will omit a value whose get rethrows false from deeper', () => {
    function read(): never {
      throw false;
    }

    const { data } = managed({ foo: 1, bar: { get: () => read() } });

    expect(store.values(data)).toEqual({ foo: 1 });
  });

  it('will throw a promise from get', () => {
    const promise = Promise.resolve();
    const { data } = managed({ bar: { get(): never { throw promise; } } });

    let thrown;

    try {
      store.values(data);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(promise);
  });

  it('will throw an error from get', () => {
    const { data } = managed({ bar: { get get(): never { throw new Error('nope'); } } });

    expect(() => store.values(data)).toThrow('nope');
  });

  it('will export as is a value whose get is null', () => {
    const bar = { get: null, id: 1 };
    const { data } = managed({ bar });

    expect(store.values(data)).toEqual({ bar });
  });

  it('will export as is a value whose get takes a parameter', () => {
    const bar = new Map([['a', 1]]);
    const { data } = managed({ bar });

    expect(store.values(data).bar).toBe(bar);
  });

  it('will export a function through its get', () => {
    const bar = Object.assign(() => {}, { get: () => 'baz' });
    const { data } = managed({ bar });

    expect(store.values(data)).toEqual({ bar: 'baz' });
  });

  it('will omit a function whose get throws false', () => {
    const bar = Object.assign(() => {}, { get(): never { throw false; } });
    const { data } = managed({ foo: 1, bar });

    expect(store.values(data)).toEqual({ foo: 1 });
  });

  it('will export as is a value whose get is not a function', () => {
    const bar = { get: 'baz' };
    const { data } = managed({ bar });

    expect(store.values(data)).toEqual({ bar });
  });
});

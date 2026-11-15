import { map, set } from '@expressive/mvc';
import { describe, expect, it, vi } from 'vitest';

import { fails, flushMicrotasks, Journal, mockPromise, ran, record, start } from '../test.setup';

import { Steps } from './steps';

describe('groups', () => {
  it('will run a group concurrently and join', async () => {
    const order: string[] = [];
    const a = mockPromise();
    const b = mockPromise();

    class Test extends Journal {
      async run() {
        this.then(this.a(), this.b());
        this.c();
      }

      async a() {
        order.push('a');
        await a;
        order.push('a!');
      }

      async b() {
        order.push('b');
        await b;
        order.push('b!');
      }

      c() {
        order.push('c');
      }
    }

    const test = Test.new();

    test.run();
    await flushMicrotasks();
    expect(order).toEqual(['a', 'b']);

    b.resolve();
    await flushMicrotasks();
    expect(order).toEqual(['a', 'b', 'b!']);
    expect(test.then.active).toBe('a');

    a.resolve();
    await test;
    expect(order).toEqual(['a', 'b', 'b!', 'a!', 'c']);
    expect(record(test)[0].next).toEqual([
      { id: 'then#1', key: 'then', args: [], group: [{ id: 'a#1', key: 'a', args: [] }, { id: 'b#1', key: 'b', args: [] }] },
      { id: 'c#1', key: 'c', args: [] }
    ]);
  });

  it('will join each member through what it schedules', async () => {
    const order: string[] = [];

    class Test extends Steps {
      async run() {
        this.then(this.a(), this.b());
        this.c();
      }

      async a() {
        await flushMicrotasks();
        this.a1();
      }

      async a1() {
        await flushMicrotasks();
        order.push('a1');
      }

      b() {
        order.push('b');
      }

      c() {
        order.push('c');
      }
    }

    await Test.new().run();
    expect(order).toEqual(['b', 'a1', 'c']);
  });

  it('will attribute writes to their own step', async () => {
    const a = mockPromise();

    class Test extends Journal {
      x = 0;
      y = 0;

      async run() {
        this.then(this.a(), this.b());
      }

      async a() {
        await a;
        this.x = 1;
      }

      async b() {
        this.y = 1;
        a.resolve();
      }
    }

    const [test] = await ran(Test);

    expect(record(test).map((entry) => [entry.key, entry.wrote])).toEqual([
      ['run', []],
      ['b', ['y']],
      ['a', ['x']]
    ]);
  });

  it('will map items to a group', async () => {
    const seen: unknown[] = [];

    class Test extends Steps {
      async run(items: string[]) {
        this.then(items, (item) => this.fetch(item));
      }

      fetch(item: string) {
        seen.push(item);
      }
    }

    await Test.new().run(['a', 'b']);
    expect(seen).toEqual(['a', 'b']);
  });

  it('will map items through a step with its index', async () => {
    const seen: unknown[][] = [];

    class Test extends Steps {
      async run(items: string[]) {
        this.then(items, this.fetch);
      }

      fetch(item: string, index: number) {
        seen.push([item, index]);
      }
    }

    await Test.new().run(['a', 'b']);
    expect(seen).toEqual([['a', 0], ['b', 1]]);
  });

  it('will fail if a step calls then as a thenable', async () => {
    class Test extends Steps {
      async run() {
        (this.then as Function)(() => {}, () => {});
      }
    }

    await fails(Test, 'a step cannot await its own run.');
  });

  it('will map an iterable to a group', async () => {
    const seen: string[] = [];

    class Test extends Steps {
      items = new Set(['a', 'b']);

      async run() {
        this.then(this.items, this.fetch);
      }

      fetch(item: string) {
        seen.push(item);
      }
    }

    await Test.new().run();
    expect(seen).toEqual(['a', 'b']);
  });

  it('will fail if a step other than run awaits its own run', async () => {
    class Test extends Steps {
      async run() {
        this.first();
      }

      protected async first() {
        await this;
      }
    }

    await fails(Test, 'a step cannot await its own run.');
  });

  it('will fail if a group holds what the step did not call', async () => {
    class Test extends Steps {
      async run() {
        this.then(new Date() as never);
      }
    }

    await fails(Test, 'then() takes steps called by run.');
  });

  it('will not take an array of tokens as a group', async () => {
    class Test extends Steps {
      async run() {
        this.then([this.a(), this.b()]);
      }

      a() {}
      b() {}
    }

    await fails(Test, 'then() takes steps called by run.');
  });

  it('will group a single token', async () => {
    class Test extends Journal {
      async run() {
        this.then(this.a());
      }

      a() {}
    }

    const [test] = await ran(Test);

    expect(record(test)[0].next).toEqual([
      { id: 'then#1', key: 'then', args: [], group: [{ id: 'a#1', key: 'a', args: [] }] }
    ]);
  });

  it('will throw if a group is made outside a step', () => {
    class Test extends Steps {
    }

    expect(() => Test.new().then([])).toThrow('then(steps) must be called inside a step.');
  });
});

describe('suspense', () => {
  it('will wait in run for a pending value', async () => {
    let tries = 0;

    class Test extends Journal {
      price = set<number>();
      total = 0;

      async run() {
        tries++;
        this.total = this.price * 2;
      }
    }

    const [test, result] = await start(Test);

    expect(tries).toBe(1);
    expect(test.then.status).toBe('running');
    expect(test.then.active).toBe('run');
    expect(record(test)).toEqual([]);

    test.price = 3;

    await result;
    expect(tries).toBe(2);
    expect(test.total).toBe(6);
    expect(record(test)).toEqual([
      { id: 'run#1', key: 'run', args: [], wrote: ['total'], next: [] }
    ]);
  });

  it('will restore writes and drop tokens of a suspended try', async () => {
    const order: string[] = [];

    class Test extends Journal {
      price = set<number>();
      note = '';

      async run() {
        this.quote();
      }

      async quote() {
        this.note = 'quoting';
        order.push(`quote:${this.note}`);
        this.report();
        this.price;
      }

      async report() {
        order.push(`report:${this.note}`);
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(order).toEqual(['quote:quoting']));
    expect(test.note).toBe('');

    test.price = 5;

    await result;
    expect(order).toEqual(['quote:quoting', 'quote:quoting', 'report:quoting']);
    expect(record(test).map(({ id, wrote, next }) => [id, wrote, next.map((node) => node.id)])).toEqual([
      ['run#1', [], ['quote#1']],
      ['quote#1', ['note'], ['report#2']],
      ['report#2', [], []]
    ]);
  });

  it('will wait for a getter over a pending value', async () => {
    class Test extends Steps {
      price = set<number>();
      total = 0;

      get taxed() {
        return this.price * 2;
      }

      async run() {
        this.total = this.taxed;
      }
    }

    const [test, result] = await start(Test);

    test.price = 4;

    await result;
    expect(test.total).toBe(8);
  });

  it('will wait after an await', async () => {
    const work = mockPromise();
    let tries = 0;

    class Test extends Steps {
      price = set<number>();
      total = 0;

      async run() {
        tries++;
        await work;
        this.total = this.price;
      }
    }

    const test = Test.new();
    const result = test.run();

    work.resolve();
    await vi.waitFor(() => expect(tries).toBe(1));
    await flushMicrotasks();

    test.price = 7;

    await result;
    expect(tries).toBe(2);
    expect(test.total).toBe(7);
  });

  it('will fail with the rejection of a pending value', async () => {
    const pending = mockPromise();

    class Test extends Journal {
      value = 0;

      async run() {
        this.value = 1;
        throw pending;
      }
    }

    const [test, result] = await start(Test);

    pending.reject(new Error('gone'));

    await expect(result).rejects.toThrow('gone');
    expect(test.value).toBe(0);
    expect(test.then.status).toBe('failed');
    expect(record(test)).toEqual([expect.objectContaining({ id: 'run#1', error: new Error('gone') })]);
  });

  it('will not count a suspended try as a retry', async () => {
    const pending = mockPromise();
    const retries: number[] = [];

    class Test extends Journal {
      async run() {
        this.flaky().catch(this.again);
      }

      protected async flaky() {
        retries.push(this.then.retried);

        if (retries.length == 1) throw pending;
        if (retries.length == 2) throw new Error('flaky');
      }

      protected async again() {
        this.then.retry();
      }
    }

    const [test, result] = await start(Test);

    pending.resolve();

    await result;
    expect(retries).toEqual([0, 0, 1]);
    expect(record(test).slice(1)).toEqual([
      { id: 'flaky#1', key: 'flaky', args: [], wrote: [], next: [], error: new Error('flaky') },
      { id: 'again#1', key: 'again', args: [{ name: 'Error', message: 'flaky' }], wrote: [], next: [{ id: 'flaky#2', key: 'flaky', args: [], rescue: 'again' }] },
      { id: 'flaky#2', key: 'flaky', args: [], wrote: [], next: [], retried: 1 }
    ]);
  });

  it('will catch a rejected pending value', async () => {
    const pending = mockPromise();
    let tries = 0;

    class Test extends Journal {
      async run() {
        this.flaky().catch(this.again);
      }

      protected async flaky() {
        if (++tries == 1) throw pending;
      }

      protected async again() {
        this.then.retry();
      }
    }

    const [test, result] = await start(Test);

    pending.reject(new Error('gone'));

    await result;
    expect(tries).toBe(2);
    expect(record(test).slice(1).map(({ key, retried, error }) => [key, retried, error])).toEqual([['flaky', undefined, new Error('gone')], ['again', undefined, undefined], ['flaky', 1, undefined]]);
  });

  it('will not fire hooks again', async () => {
    const order: string[] = [];

    class Test extends Steps {
      price = set<number>();

      async run() {
        order.push(`run:${this.price}`);
      }

      before(key: string) {
        order.push(`before:${key}`);
      }

      after(key: string) {
        order.push(`after:${key}`);
      }
    }

    const [test, result] = await start(Test);

    test.price = 1;

    await result;
    expect(order).toEqual(['before:run', 'run:1', 'after:run']);
  });

  it('will abort when stopped while waiting', async () => {
    class Test extends Journal {
      price = set<number>();
      value = 0;

      async run() {
        this.value = 1;
        this.value = this.price;
      }
    }

    const [test, result] = await start(Test);

    test.then.stop();

    await expect(result).rejects.toMatchObject({ name: 'Stopped' });
    expect(test.value).toBe(0);
    expect(test.then.status).toBe('stopped');
    expect(record(test)).toEqual([]);
  });

  it('will end once a step waiting on a value finishes', async () => {
    class Test extends Journal {
      price = set<number>();

      async run() {
        this.price;
      }
    }

    const [test, result] = await start(Test);

    test.then.end();
    test.price = 1;

    expect(await result).toBeUndefined();
    expect(test.then.status).toBe('idle');
    expect(test.then.runs).toBe(1);
  });

  it('will abort a pending read after the step was stopped', async () => {
    const work = mockPromise();

    class Test extends Steps {
      price = set<number>();

      async run() {
        await work;
        this.price;
      }
    }

    const [test, result] = await start(Test);

    test.then.stop();
    work.resolve();

    await expect(result).rejects.toMatchObject({ name: 'Stopped' });
    expect(test.then.error).toBeUndefined();
  });

  it('will fail a committed step reading a pending value', async () => {
    const pending = mockPromise();

    class Test extends Steps {
      async run() {
        this.then.commit();
        throw pending;
      }
    }

    const test = Test.new();

    await expect(test.run()).rejects.toBe(pending);
    expect(test.then.error).toBe(pending);
  });

  it('will fail a hook reading a pending value after its step', async () => {
    class Test extends Steps {
      price = set<number>();

      async run() {}

      after() {
        this.price;
      }
    }

    const test = Test.new();

    await expect(test.run()).rejects.toBeInstanceOf(Promise);
  });

  it('will run undos a suspended try registered before running it again', async () => {
    const pending = mockPromise<number>();
    const order: string[] = [];

    class Test extends Steps {
      price = set<number>();

      async run() {
        this.charge();
      }

      protected async charge() {
        this.then.on({ reset: this.release('t' + order.length) });
        order.push('try');
        order.push(`price ${this.price}`);
      }

      protected async release(id: string) {
        order.push(`release ${id}`);
      }
    }

    const [test, result] = await start(Test);

    test.price = 3;
    pending.resolve(3);

    await result;
    expect(order).toEqual(['try', 'release t0', 'try', 'price 3']);
  });
});

describe('scale', () => {
  async function work(make: (size: number) => Steps & { run(): Promise<unknown> }) {
    const { push } = Array.prototype;
    const { get } = Map.prototype;
    let count = 0;

    const measure = async (size: number) => {
      const test = make(size);

      count = 0;
      await test.run();
      await test;

      return count;
    };

    Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
      count++;
      return push.apply(this, items);
    };

    Map.prototype.get = function (this: Map<unknown, unknown>, key: unknown) {
      count++;
      return get.call(this, key);
    };

    try {
      const small = await measure(500);
      const large = await measure(2000);

      return large / small;
    } finally {
      Array.prototype.push = push;
      Map.prototype.get = get;
    }
  }

  class Chain extends Steps {
    size = 0;
    count = 0;

    async run() {
      this.page(0);
    }

    protected async page(index: number) {
      await Promise.resolve();
      this.count = index + 1;

      if (this.count < this.size) this.page(this.count);
    }
  }

  it('will grow linearly with a chain of steps', async () => {
    const growth = await work((size) => Chain.new({ size }));

    expect(growth).toBeLessThan(5);
  });

  it('will grow linearly with a chain of steps after a caught failure', async () => {
    class Test extends Chain {
      async run() {
        this.fail().catch();
        this.page(0);
      }

      protected async fail() {
        throw new Error('skipped');
      }
    }

    const growth = await work((size) => Test.new({ size }));

    expect(growth).toBeLessThan(5);
  });

  it('will grow linearly with a wide group of steps', async () => {
    class Test extends Steps {
      size = 0;
      found = map<number, number>();

      async run() {
        this.then(Array.from({ length: this.size }, (_, index) => index), this.visit);
      }

      protected async visit(index: number) {
        await Promise.resolve();
        this.found.set(index, index);
      }
    }

    const growth = await work((size) => Test.new({ size }));

    expect(growth).toBeLessThan(5);
  });
});

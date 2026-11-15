import { has, map, Model } from '@expressive/mvc';
import { describe, expect, it, vi } from 'vitest';

import { fails, flushMicrotasks, Journal, mockPromise, ran, record, start } from '../test.setup';

import { Steps } from './steps';

describe('functions', () => {
  it('will throw if given a function in place of a step', async () => {
    class Test extends Steps {
      async run() {
        this.then(() => {});
      }
    }

    await fails(Test, 'then() takes steps, not a function - declare the work as a step.');
  });

  it('will run a function reset with no arguments', async () => {
    const refund = vi.fn();

    class Test extends Journal {
      async run() {
        this.charge();
      }

      protected async charge() {
        this.then.on({ reset: refund });
        this.fail();
      }

      async fail() {
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(refund).toHaveBeenCalledWith();
    expect(record(test)[1]).toMatchObject({ on: { reset: [{ id: 'then#1', key: 'then', args: [] }] }, unwound: true });
    expect(record(test)[1].next).toEqual([{ id: 'fail#1', key: 'fail', args: [] }]);
  });
});

describe('collections', () => {
  class Item extends Model {
    name = '';
  }

  it('will roll back list push, put, pop and set', async () => {
    class Test extends Journal {
      items = has(['a', 'b', 'c']);

      async run() {
        this.charge();
      }

      async charge() {
        this.items.push('d');
        this.items.put(0, 'z');
        this.items.pop(1);
        this.items.set(-1, 'e');
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(test.items.get()).toEqual(['a', 'b', 'c']);
    expect(record(test)).toEqual([expect.objectContaining({ id: 'run#1' }), expect.objectContaining({ wrote: ['items'], unwound: true }), expect.objectContaining({ id: 'fail#1', error: new Error('boom') })]);
  });

  it('will record nothing for a read without change', async () => {
    class Test extends Journal {
      items = has(['a']);
      count = 0;

      async run() {
        this.count = this.items.size;
      }
    }

    const [test] = await ran(Test);

    expect(record(test)[0].wrote).toEqual(['count']);
  });

  it('will journal a changed collection by name, without values', async () => {
    class Test extends Journal {
      items = has(Item);

      async run(name: string) {
        this.items.add({ name });
      }
    }

    const [test] = await ran(Test, 'a');

    await test.run('b');
    expect(record(test)).toEqual([{ id: 'run#1', key: 'run', args: ['b'], next: [], wrote: ['items'] }]);
  });

  it('will not capture writes outside a step proxy', async () => {
    class Test extends Journal {
      items = has<string>();

      async run() {
        this.is.items.push('a');
      }
    }

    const [test] = await ran(Test);

    expect(record(test)[0].wrote).toEqual([]);
  });

  it('will restore a list before a retry', async () => {
    let tries = 0;

    class Test extends Journal {
      items = has<string>();

      async run() {
        this.push().catch(this.push);
      }

      protected async push() {
        this.items.push(`try ${++tries}`);

        if (tries < 2) throw new Error('flaky');
      }
    }

    const [test] = await ran(Test);

    expect(test.items.get()).toEqual(['try 2']);
    expect(record(test).map((entry) => entry.wrote)).toEqual([[], [], ['items']]);
  });

  it('will attribute a change only to the step making it', async () => {
    const gate = mockPromise();

    class Test extends Journal {
      items = has(['a']);

      async run() {
        this.then(this.write(), this.read());
        this.fail();
      }

      protected async write() {
        await gate;
        this.items.push('b');
      }

      protected async read() {
        this.items.size;
        await gate;
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    const [test, result] = await start(Test);

    gate.resolve();

    await expect(result).rejects.toThrow('boom');
    expect(test.items.get()).toEqual(['a']);
    expect(record(test).map((entry) => [entry.key, entry.wrote, entry.unwound])).toEqual([
      ['run', [], undefined],
      ['write', ['items'], true],
      ['read', [], undefined],
      ['fail', [], undefined]
    ]);
  });

  it('will keep a sibling\'s pushes when a parallel step fails', async () => {
    const gate = mockPromise();

    class Test extends Steps {
      items = has<string>();

      async run() {
        this.then(this.good(), this.bad().catch());
      }

      protected async good() {
        this.items.push('good');
      }

      protected async bad() {
        this.items.push('bad');
        await gate;
        throw new Error('boom');
      }
    }

    const [test, result] = await start(Test);

    expect(test.items.get()).toEqual(['good', 'bad']);

    gate.resolve();

    await result;
    expect(test.items.get()).toEqual(['good']);
  });

  it('will keep a sibling\'s pushes when a parallel step retries', async () => {
    let tries = 0;

    class Test extends Steps {
      items = has<string>();

      async run() {
        this.then(this.flaky().catch(this.flaky), this.steady());
      }

      protected async flaky() {
        this.items.push(`flaky ${++tries}`);
        await Promise.resolve();

        if (tries < 2) throw new Error('flaky');
      }

      protected async steady() {
        this.items.push('steady');
      }
    }

    const [test] = await ran(Test);

    expect(test.items.get()).toEqual(['steady', 'flaky 2']);
  });

  it('will undo only its own change around a sibling\'s', async () => {
    const gate = mockPromise();

    class Test extends Steps {
      items = has(['a', 'b']);

      async run() {
        this.then(this.bad().catch(), this.good());
      }

      protected async bad() {
        this.items.push('x', 'y');
        this.items.set(0, 'z');
        await gate;
        throw new Error('boom');
      }

      protected async good() {
        await Promise.resolve();
        this.items.put(0, 'first');
        this.items.push('last');
      }
    }

    const [test, result] = await start(Test);

    expect(test.items.get()).toEqual(['first', 'z', 'b', 'x', 'y', 'last']);

    gate.resolve();

    await result;
    expect(test.items.get()).toEqual(['first', 'a', 'b', 'last']);
  });

  it('will skip an undo whose value a sibling removed', async () => {
    const gate = mockPromise();

    class Test extends Steps {
      items = has(['a']);

      async run() {
        this.then(this.bad().catch(), this.good());
      }

      protected async bad() {
        this.items.push('x');
        this.items.set(0, 'z');
        await gate;
        throw new Error('boom');
      }

      protected async good() {
        await Promise.resolve();
        this.items.clear();
        this.items.push('kept');
      }
    }

    const [test, result] = await start(Test);

    gate.resolve();

    await result;
    expect(test.items.get()).toEqual(['kept']);
  });

  it('will undo the nearest of equal values', async () => {
    class Test extends Steps {
      items = has(['a', 'b', 'a', 'c', 'a']);

      async run() {
        this.items.put(2, 'a');
        this.items.clear();
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(test.items.get()).toEqual(['a', 'b', 'a', 'c', 'a']);
  });

  it('will record nothing for a list call changing nothing', async () => {
    class Test extends Journal {
      items = has(['a']);

      async run() {
        this.items.push();
        this.items.put(0);
        this.items.set(5, 'x');
        this.items.set(0, 'a');
        this.items.pop(3);
        this.items.pop(0, 1);
        this.items.pop();
        this.items.clear();
      }
    }

    const [test] = await ran(Test);

    expect(record(test)[0].wrote).toEqual(['items']);
    expect(test.items.size).toBe(0);
  });

  it('will fail a collection change after scheduling', async () => {
    class Test extends Steps {
      items = has(['a']);

      async run() {
        this.later();
        this.items.push('b');
      }

      protected async later() {}
    }

    const [test] = await fails(Test, 'run wrote items after scheduling later.');

    expect(test.items.get()).toEqual(['a']);
  });

  it('will not fail a collection call changing nothing after scheduling', async () => {
    class Test extends Steps {
      items = has<string>();

      async run() {
        this.later();
        this.items.pop();
      }

      protected async later() {}
    }

    const [test] = await ran(Test);

    expect(test.then.status).toBe('idle');
  });

  it('will leave a change through a settled step\'s collection unmanaged', async () => {
    let items!: has.List<string>;

    class Test extends Journal {
      list = has<string>();

      async run() {
        items = this.list;
      }
    }

    const [test] = await ran(Test);

    items.push('late');
    expect(test.list.get()).toEqual(['late']);
    expect(record(test)[0].wrote).toEqual([]);
  });

  it('will hand one wrapper per collection to a step', async () => {
    class Test extends Steps {
      items = has(['a']);
      same = false;

      async run() {
        this.same = this.items === this.items && this.items.get(0) === 'a' && this.items.size == 1;
      }
    }

    const [test] = await ran(Test);

    expect(test.same).toBe(true);
  });

  it('will restore the earliest snapshot of parallel steps', async () => {
    const first = mockPromise();
    const second = mockPromise();

    class Test extends Steps {
      items = has(['a']);

      async run() {
        this.then(this.early(), this.late());
        this.fail();
      }

      protected async early() {
        this.items.push('b');
        await first;
      }

      protected async late() {
        await second;
        this.items.push('c');
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    const [test, result] = await start(Test);

    second.resolve();
    await flushMicrotasks();
    first.resolve();

    await expect(result).rejects.toThrow('boom');
    expect(test.items.get()).toEqual(['a']);
  });

  it('will roll back a map', async () => {
    class Test extends Journal {
      values = map([['a', 1], ['b', 2], ['c', 3]]);

      async run() {
        this.charge();
      }

      async charge() {
        this.values.set('a', 10);
        this.values.delete('b');
        this.values.set('d', 4);
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(test.values.get()).toEqual(new Map([['a', 1], ['b', 2], ['c', 3]]));
  });

  it('will restore a guest Model removed from a map', async () => {
    const guest = Item.new({ name: 'guest' });

    class Test extends Journal {
      values = map<string, Item>([['a', guest]]);

      async run() {
        this.charge();
      }

      async charge() {
        this.values.delete('a');
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(test.values.get('a')).toBe(guest);
    expect(record(test)[1].irreversible).toBeUndefined();
  });

  it('will remove pool members added by a failed run', async () => {
    class Test extends Journal {
      items = has(Item);

      protected new() {
        this.items.add({ name: 'kept' });
      }

      async run() {
        this.add();
        this.fail();
      }

      protected async add() {
        this.items.add({ name: 'a' });
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(record(test)[1]).toMatchObject({ wrote: ['items'], unwound: true });
    expect(test.items.map((item) => item.name)).toEqual(['kept']);
  });

  it('will destroy a member a failing step added', async () => {
    let added!: Item;

    class Test extends Steps {
      items = has(Item);

      async run() {
        added = this.items.add({ name: 'a' });
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(test.items.size).toBe(0);
    expect(added.get(null)).toBe(true);
  });

  it('will keep a sibling\'s map entries when a parallel step fails', async () => {
    const gate = mockPromise();

    class Test extends Steps {
      values = map<string, number>([['a', 1], ['b', 2]]);

      async run() {
        this.then(this.bad().catch(), this.good());
      }

      protected async bad() {
        this.values.set('a', 2).set('n', 1);
        this.values.delete('b');
        await gate;
        throw new Error('boom');
      }

      protected async good() {
        await Promise.resolve();
        this.values.set('g', 1);
        this.values.set('n', 5);
        this.values.set('b', 7);
      }
    }

    const [test, result] = await start(Test);

    gate.resolve();

    await result;
    expect(test.values.get()).toEqual(new Map([['a', 1], ['n', 5], ['g', 1], ['b', 7]]));
  });

  it('will restore a cleared map', async () => {
    class Test extends Steps {
      values = map<string, number>([['a', 1], ['b', 2]]);
      empty = map<string, number>();

      async run() {
        this.values.clear();
        this.values.set('c', 3);
        this.values.set('c', 3);
        this.values.delete('x');
        this.empty.clear();
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(test.values.get()).toEqual(new Map([['a', 1], ['b', 2]]));
  });

  it('will remove a key it added and replaced', async () => {
    class Test extends Journal {
      values = map<string, Model>();
      plain = map<string, number>();

      async run() {
        this.values.set('a', Item.new({ name: 'a' }));
        this.values.set('a', Item.new({ name: 'b' }));
        this.values.delete('a');
        this.values.set('a', Item.new({ name: 'c' }));
        this.plain.set('x', 1);
        this.plain.set('x', 2);
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(test.values.size).toBe(0);
    expect(test.plain.size).toBe(0);
    expect(record(test)).toEqual([expect.objectContaining({ id: 'run#1', error: new Error('boom') })]);
  });

  it('will keep a sibling\'s pool members when a parallel step fails', async () => {
    const gate = mockPromise();
    const kept = Item.new({ name: 'kept' });

    class Test extends Steps {
      items = has(Item);

      protected new() {
        this.items.add(kept);
      }

      async run() {
        this.then(this.bad().catch(), this.good());
      }

      protected async bad() {
        this.items.add({ name: 'bad' });
        this.items.add(kept);
        this.items.delete(Item.new());
        await gate;
        throw new Error('boom');
      }

      protected async good() {
        await Promise.resolve();
        this.items.add({ name: 'good' });
      }
    }

    const [test, result] = await start(Test);

    gate.resolve();

    await result;
    expect(test.items.map((item) => item.name)).toEqual(['kept', 'good']);
  });

  it('will not be irreversible removing members it added', async () => {
    class Test extends Journal {
      items = has(Item);
      empty = has(Item);

      async run() {
        const item = this.items.add({ name: 'a' });

        this.items.delete(item);
        this.items.add({ name: 'b' });
        this.items.clear();
        this.empty.clear();
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(test.items.size).toBe(0);
    expect(record(test)).toEqual([expect.objectContaining({ id: 'run#1', error: new Error('boom') })]);
  });

  it('will let a handler change a collection the branch changed', async () => {
    class Test extends Steps {
      items = has<string>();

      async run() {
        this.first().catch(this.handle);
      }

      protected async first() {
        this.items.push('a');
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }

      protected async handle() {
        this.items.push('b');
      }
    }

    const [test] = await ran(Test);

    expect(test.items.get()).toEqual(['a', 'b']);
  });

  it('will keep a list field through a run', async () => {
    class Test extends Steps {
      items = has<string>();

      async run(item: string) {
        this.items.push(item);
      }
    }

    const [test] = await ran(Test, 'a');

    await test.run('b');
    expect([...test.items]).toEqual(['a', 'b']);
  });
});

describe('signal', () => {
  const aborted = (signal: AbortSignal) =>
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));

  it('will abort the signal of a step in flight on stop', async () => {
    const attempt = vi.fn();

    class Test extends Journal {
      value = 0;

      async run() {
        attempt();
        this.value = 1;
        await aborted(this.then.signal);
        this.later();
      }

      later() {}
    }

    const [test, result] = await start(Test);

    test.then.stop();

    await expect(result).rejects.toMatchObject({ name: 'Stopped' });
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(test.value).toBe(0);
    expect(test.then.status).toBe('stopped');
    expect(test.then.error).toBeUndefined();
    expect(record(test)).toEqual([]);
  });

  it('will let a step in flight finish on an outside end, dropping what it schedules', async () => {
    const work = mockPromise();
    const later = vi.fn();
    let signal!: AbortSignal;

    class Test extends Journal {
      value = 0;

      async run() {
        this.slow();
      }

      async slow() {
        signal = this.then.signal;
        this.value = 1;
        await work;
        this.later();
      }

      later() {
        later();
      }
    }

    const [test, result] = await start(Test);

    test.then.end();
    expect(signal.aborted).toBe(false);
    work.resolve();

    await result;
    expect(test.value).toBe(1);
    expect(later).not.toHaveBeenCalled();
    expect(record(test).map((entry) => entry.key)).toEqual(['run', 'slow', 'end']);
  });

  it('will abort the signal of a step in flight when another fails', async () => {
    let signal!: AbortSignal;

    class Test extends Steps {
      async run() {
        this.then(this.slow(), this.fail());
      }

      async slow() {
        signal = this.then.signal;
        await aborted(signal);
      }

      async fail() {
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(signal.aborted).toBe(true);
    expect(test.then.error).toEqual(new Error('boom'));
  });

  it('will abort the signal once its step settles', async () => {
    const seen: boolean[] = [];
    let signal!: AbortSignal;

    class Test extends Steps {
      async run() {
        signal = this.then.signal;
        seen.push(signal.aborted);
        this.second();
      }

      async second() {
        seen.push(signal.aborted, this.then.signal === signal);
      }
    }

    await Test.new().run();
    expect(seen).toEqual([false, true, false]);
  });

  it('will throw if signal is read outside a step', () => {
    class Test extends Steps {
    }

    expect(() => Test.new().then.signal).toThrow('signal must be read inside a step.');
  });
});

describe('failures', () => {
  it('will reject when a step throws synchronously', async () => {
    class Test extends Steps {
      async run() {
        throw new Error('sync');
      }
    }

    const [test] = await fails(Test, 'sync');

    expect(test.then.status).toBe('failed');
    expect(test.then.error).toEqual(new Error('sync'));
  });

  it('will reject when a step rejects and discard what it scheduled', async () => {
    const called = vi.fn();

    class Test extends Steps {
      async run() {
        this.second();
        throw new Error('after scheduling');
      }

      second() {
        called();
      }
    }

    await fails(Test, 'after scheduling');
    expect(called).not.toHaveBeenCalled();
  });

  it('will reject when a step returns a value', async () => {
    class Test extends Steps {
      async run() {
        this.first();
      }

      async first() {
        return 1 as unknown as void;
      }
    }

    await fails(Test, 'first returned a value; a step returns nothing - its undo is this.then.on({ reset }).');
  });

  it('will reject when a step writes after scheduling', async () => {
    class Test extends Steps {
      value = 0;

      async run() {
        this.first();
        this.value = 1;
      }

      first() {}
    }

    const [test] = await fails(Test, 'run wrote value after scheduling first.');

    expect(test.value).toBe(0);
  });

  it('will not guard writes of a helper after scheduling', async () => {
    class Test extends Journal {
      value = 0;

      async run() {
        this.first();
        this._set();
      }

      _set() {
        this.value = 1;
      }

      first() {}
    }

    const [test] = await ran(Test);

    expect(test.value).toBe(1);
    expect(record(test)[0].wrote).toEqual([]);
  });

  it('will reject when a step keeps working after scheduling', async () => {
    class Test extends Steps {
      async run() {
        this.second();
        await flushMicrotasks();
      }

      second() {}
    }

    await fails(Test, 'run kept working after scheduling second.');
  });

  it('will throw if a step is called after its caller settled', async () => {
    let late: () => unknown = () => {};

    class Test extends Steps {
      async run() {
        late = () => this.second();
      }

      second() {}
    }

    await Test.new().run();
    expect(late).toThrow('run has settled; second cannot run.');
  });

  it('will throw if a settled step schedules through then', async () => {
    let late: () => unknown = () => {};

    class Test extends Steps {
      async run() {
        late = () => this.then.end();
      }
    }

    await Test.new().run();
    expect(late).toThrow('run has settled; end cannot run.');
  });
});

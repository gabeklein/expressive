import { has, map, Model } from '@expressive/mvc';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { fails, flushMicrotasks, ids, Journal, mockPromise, mockUncaught, mockWarn, ran, record, start } from '../test.setup';

import { Steps } from './steps';

describe('catch', () => {
  afterEach(() => void vi.useRealTimers());

  it('will unwind a caught branch and continue', async () => {
    const undo = vi.fn();

    class Test extends Journal {
      value = 0;

      async run() {
        this.a().catch();
        this.b();
      }

      protected async a() {
        this.value = 1;
        this.then.on({ reset: undo });
        this.a1();
      }

      protected async a1() {
        this.value = 2;
        throw new Error('boom');
      }

      protected async b() {}
    }

    const [test] = await ran(Test);

    expect(test.value).toBe(0);
    expect(undo).toHaveBeenCalledWith();
    expect(record(test)).toEqual([
      {
        id: 'run#1',
        key: 'run',
        args: [],
        wrote: [],
        next: [
          { id: 'a#1', key: 'a', args: [], rescue: true },
          { id: 'b#1', key: 'b', args: [] }
        ]
      },
      expect.objectContaining({ id: 'a#1', on: { reset: [{ id: 'then#1', key: 'then', args: [] }] }, unwound: true }),
      expect.objectContaining({ id: 'a1#1', error: new Error('boom') }),
      expect.objectContaining({ id: 'b#1' })
    ]);
  });

  it('will pass a caught try to after', async () => {
    const seen: unknown[] = [];

    class Test extends Steps {
      async run() {
        this.scan('x').catch(this.fallback);
      }

      protected async scan(site: string) {
        throw new Error(`${site} is down`);
      }

      protected async fallback() {}

      protected after(step: string, entry: Steps.Entry) {
        seen.push([step, entry.error]);
      }
    }

    await Test.new().run();

    expect(seen).toEqual([
      ['run', undefined],
      ['scan', new Error('x is down')],
      ['fallback', undefined]
    ]);
  });

  it('will fail the run when after throws on a caught try', async () => {
    class Test extends Steps {
      async run() {
        this.scan().catch();
      }

      protected async scan() {
        throw new Error('down');
      }

      protected after(step: string, entry: Steps.Entry) {
        if (entry.error) throw new Error('after');
      }
    }

    await fails(Test, 'after');
  });

  it('will run a step in the caught branch\'s place given the error', async () => {
    const seen = vi.fn();

    class Test extends Journal {
      async run() {
        this.scan('x').catch(this.fallback);
        this.after1();
      }

      protected async scan(site: string) {
        throw new Error(`${site} is down`);
      }

      protected async fallback(error: unknown) {
        seen(error, this.then.retried);
      }

      protected async after1() {
        seen('after');
      }
    }

    const [test] = await ran(Test);

    expect(seen.mock.calls).toEqual([[new Error('x is down'), 0], ['after']]);
    expect(record(test)[0].next[0]).toEqual({ id: 'scan#1', key: 'scan', args: ['x'], rescue: 'fallback' });
    expect(record(test).map((entry) => [entry.id, entry.args])).toEqual([
      ['run#1', []],
      ['scan#1', ['x']],
      ['fallback#1', [{ name: 'Error', message: 'x is down' }]],
      ['after1#1', []]
    ]);
  });

  it('will count retries of a step replayed by retry()', async () => {
    const retries: number[] = [];

    class Test extends Journal {
      async run() {
        this.then(['a'], (site) => this.visit(site).catch(this.revisit));
      }

      protected async visit(site: string) {
        retries.push(this.then.retried);
        this.scan(site);
      }

      protected async scan(site: string) {
        throw new Error(`${site} is down`);
      }

      protected async revisit(error: unknown) {
        if (this.then.retried >= 2) throw error;

        this.then.retry();
      }
    }

    const [test] = await fails(Test, 'a is down');

    expect(retries).toEqual([0, 1, 2]);
    expect(record(test).map(({ id, retried, error }) => [id, retried, (error as Error)?.message])).toEqual([
      ['run#1', undefined, undefined],
      ['visit#1', undefined, undefined],
      ['scan#1', undefined, 'a is down'],
      ['revisit#1', undefined, undefined],
      ['visit#2', 1, undefined],
      ['scan#2', undefined, 'a is down'],
      ['revisit#2', 1, undefined],
      ['visit#3', 2, undefined],
      ['scan#3', undefined, 'a is down'],
      ['revisit#3', 2, 'a is down']
    ]);
  });

  it('will retry a group as a whole, with its args', async () => {
    const order: string[] = [];

    class Test extends Journal {
      async run() {
        this.then(this.a('x'), this.b('y')).catch(this.again);
      }

      protected async a(arg: string) {
        order.push(`a ${arg} ${this.then.retried}`);
      }

      protected async b(arg: string) {
        order.push(`b ${arg} ${this.then.retried}`);

        if (!this.then.retried) throw new Error('b');
      }

      protected async again() {
        this.then.retry();
      }
    }

    const [test] = await ran(Test);

    expect(order).toEqual(['a x 0', 'b y 0', 'a x 1', 'b y 1']);
    expect(record(test)[0].next).toMatchObject([{ key: 'then', rescue: 'again', group: [{ key: 'a' }, { key: 'b' }] }]);
  });

  it('will retry a step and a race', async () => {
    const order: string[] = [];
    let first = true;

    class Test extends Steps {
      async run() {
        this.flaky().catch(this.again);
        this.then(this.reply, this.watch()).catch(this.again);
      }

      protected async flaky() {
        order.push('step');

        if (first) {
          first = false;
          throw new Error('step');
        }
      }

      protected async watch() {
        const retried = order.includes('watcher');

        order.push('watcher');

        if (!retried) throw new Error('watcher');

        this.reply();
      }

      reply() {
        order.push('reply');
      }

      protected async again() {
        this.then.retry();
      }
    }

    await Test.new().run();
    expect(order).toEqual(['step', 'step', 'watcher', 'watcher', 'reply']);
  });

  it('will throw for retry outside a handler, or once settled', async () => {
    let held: Steps.Controller | undefined;

    class Outside extends Steps {
      async run() {
        this.first();
      }

      protected async first() {
        this.then.retry();
      }
    }

    class Settled extends Steps {
      async run() {
        this.fail().catch(this.handle);
      }

      protected async fail() {
        throw new Error('boom');
      }

      protected async handle() {
        held = this.then;
        this.later();
      }

      protected async later() {
        held!.retry();
      }
    }

    class Bare extends Steps {
      async run() {
        this.fail().catch(this.then.retry);
      }

      protected async fail() {}
    }

    await fails(Outside, 'retry() must be called in a .catch handler.');
    await fails(Settled, 'handle has settled; retry cannot run.');
    await fails(Bare, 'catch() retries from a handler: .catch(this.rescan), rescan(error) { if (this.then.retried >= 3) throw error; this.then.retry(); }');
  });

  it('will back off a retry with a duration', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

    let tries = 0;

    class Test extends Steps {
      async run() {
        this.attempt().catch(this.again);
      }

      protected async attempt() {
        if (this.then.retried) this.then({ ms: 100 * this.then.retried });

        this.scan();
      }

      protected async scan() {
        if (++tries < 3) throw new Error('later');
      }

      protected async again() {
        this.then.retry();
      }
    }

    const result = Test.new().run();

    await vi.advanceTimersByTimeAsync(0);
    expect(tries).toBe(1);

    await vi.advanceTimersByTimeAsync(99);
    expect(tries).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(tries).toBe(2);

    await vi.advanceTimersByTimeAsync(200);
    expect(tries).toBe(3);

    await result;
  });

  it('will run a function in the caught branch\'s place given the error', async () => {
    class Test extends Journal {
      value = '';

      async run() {
        this.scan().catch((error: Error) => {
          this.value = error.message;
        });
      }

      protected async scan() {
        throw new Error('down');
      }
    }

    const [test] = await ran(Test);

    expect(test.value).toBe('down');
    expect(record(test)[0].next).toEqual([{ id: 'scan#1', key: 'scan', args: [], rescue: 'then' }]);
    expect(record(test).at(-1)).toMatchObject({ id: 'then#1', key: 'then', args: [new Error('down')], wrote: ['value'] });
  });

  it('will settle a mapped group with what succeeded', async () => {
    class Test extends Steps {
      found = has<string>();

      async run() {
        this.then(['a', 'b', 'c'], (site) => this.visit(site).catch());
      }

      protected async visit(site: string) {
        this.found.push(site);
        await Promise.resolve();

        if (site == 'b') throw new Error('blocked');
      }
    }

    const [test] = await ran(Test);

    expect(test.found.get()).toEqual(['a', 'c']);
  });

  it('will catch a group token', async () => {
    const gate = mockPromise();
    const after = vi.fn();

    class Test extends Journal {
      value = 0;

      async run() {
        this.then(this.a(), this.b(), this.c()).catch();
        this.d();
      }

      protected async a() {
        this.value = 1;
      }

      protected async b() {
        await gate;
        throw new Error('b');
      }

      protected async c() {
        await gate;
        await Promise.resolve();
        throw new Error('c');
      }

      protected async d() {
        after(this.value);
      }
    }

    const [test, result] = await start(Test);

    gate.resolve();

    await result;
    expect(after).toHaveBeenCalledWith(0);
    expect(record(test).map((entry) => [entry.id, entry.unwound])).toEqual([['run#1', undefined], ['a#1', true], ['b#1', undefined], ['c#1', undefined], ['d#1', undefined]]);
  });

  it('will catch an answer or racer of a caught wait', async () => {
    class Test extends Steps {
      async run() {
        this.then(this.answer).catch();
        this.then(this.answer, this.watch()).catch();
      }

      protected async watch() {
        throw new Error('racer');
      }

      async answer() {
        throw new Error('answer');
      }
    }

    const [test, result] = await start(Test);

    await test.answer();

    await result;
    expect(test.then.status).toBe('idle');
  });

  it('will fail the run when a caught branch\'s compensation throws', async () => {
    class Test extends Journal {
      async run() {
        this.a().catch();
      }

      protected async a() {
        this.then.on({
          reset: () => {
            throw new Error('undo');
          }
        });
        this.b();
      }

      protected async b() {
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'undo');

    expect(record(test)[1]).toMatchObject({ id: 'a#1', unwound: 'failed' });
  });

  it('will not run a handler once the run stops', async () => {
    const gate = mockPromise();
    const handler = vi.fn();

    class Test extends Steps {
      async run() {
        this.a().catch(handler);
      }

      protected async a() {
        this.then.on({ reset: () => gate });
        this.b();
      }

      protected async b() {
        throw new Error('boom');
      }
    }

    const [test, result] = await start(Test);

    test.then.stop();
    gate.resolve();

    await expect(result).rejects.toMatchObject({ name: 'Stopped' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('will not catch a broken rule', async () => {
    class Test extends Steps {
      value = 0;

      async run() {
        this.a().catch();
      }

      protected async a() {
        this.b();
        this.value = 1;
      }

      protected async b() {}
    }

    await fails(Test, 'a wrote value after scheduling b.');
  });

  it('will not catch end', async () => {
    const errors: unknown[] = [];

    class Test extends Steps {
      async run() {
        try {
          (this.then.end() as unknown as Promise<void>).catch();
        } catch (error) {
          errors.push(error);
        }
      }
    }

    await Test.new().run().catch(() => {});
    expect(errors).toEqual([new Error('end() cannot be caught.')]);
  });

  it('will throw for a handler not a function', async () => {
    class Test extends Steps {
      async run() {
        this.a().catch('a' as never);
      }

      protected async a() {}
    }

    await fails(Test, 'catch() takes a step, a function or nothing.');
  });

  it('will throw retry, catch and reset outside a step', () => {
    class Test extends Steps {}

    const test = Test.new();

    expect(() => test.then.retried).toThrow('retried must be read inside a step.');
    expect(() => test.then.retry()).toThrow('retry must be called inside a step.');
    expect(() => test.then.on({ reset: () => {} })).toThrow('on must be called inside a step.');
    expect(() => test.then.restore()).toThrow('restore must be called inside a step.');
  });

  it('will run a function catch as the node it registered', async () => {
    class Test extends Journal {
      async run() {
        this.a();
      }

      protected async a() {
        this.then.on({ catch: () => {} });
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    const [test] = await ran(Test);

    const [handler] = record(test)[1].on!.catch!;

    expect(record(test).at(-1)).toMatchObject({ id: handler.id, args: [new Error('boom')] });
  });

  it('will call a catch function plainly', async () => {
    let self: unknown = 'unset';

    class Test extends Steps {
      async run() {
        this.a();
      }

      protected async a() {
        this.then.on({
          catch() {
            self = this;
          }
        });
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    await Test.new().run();
    expect(self).toBeUndefined();
  });

  it('will journal a catch handler which fails the run', async () => {
    class Test extends Journal {
      async run(hook: boolean) {
        this.hook = hook;
        this.a().catch(this.again);
      }

      hook = false;

      protected async a() {
        throw new Error('boom');
      }

      protected async again(error: unknown) {
        if (!this.hook) this.then.on({ close: () => {} });

        throw new Error(`still ${(error as Error).message}`);
      }

      protected after(key: string, entry: Steps.Entry) {
        super.after!(key, entry);

        if (this.hook && key == 'again') throw new Error('after');
      }
    }

    const test = Test.new();

    await expect(test.run(false)).rejects.toThrow('still boom');
    expect(record(test).at(-1)).toMatchObject({ key: 'again', error: new Error('still boom') });
    await expect(Test.new().run(true)).rejects.toThrow('after');
  });

  it('will call a .catch function plainly', async () => {
    let self: unknown = 'unset';

    class Test extends Steps {
      async run() {
        this.a().catch(function (this: unknown) {
          self = this;
        });
      }

      protected async a() {
        throw new Error('boom');
      }
    }

    await Test.new().run();
    expect(self).toBeUndefined();
  });

  it('will not catch a rule broken in a step body', async () => {
    const handler = vi.fn();

    class Test extends Steps {
      async run() {
        this.a().catch(handler);
      }

      protected async a() {
        this.then(this.b(), (() => {}) as never);
      }

      protected async b() {}
    }

    await fails(Test, 'then() takes steps, not a function - declare the work as a step.');
    expect(handler).not.toHaveBeenCalled();
  });

  it('will retry a group with a wait, the copy answerable', async () => {
    const ids: string[] = [];

    class Test extends Steps {
      async run() {
        this.then(this.then(this.reply), this.fail()).catch(this.again);
      }

      async reply() {}

      protected async fail() {
        if (!this.then.retried) throw new Error('boom');
      }

      protected async again() {
        this.then.retry();
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.then.waiting[0]?.id).toBe('wait#2'));
    ids.push(test.then.waiting[0].id);
    await test.reply();
    await result;
    expect(ids).toEqual(['wait#2']);
  });
});

describe('undo', () => {
  it('will run compensations newest first and restore every step', async () => {
    const order: string[] = [];

    class Test extends Journal {
      a = 0;
      b = 0;
      c = 0;

      async run() {
        this.zero();
      }

      zero() {
        this.a = 1;
        this.then.on({ reset: () => void order.push(`undo zero a=${this.a}`) });
        this.first();
      }

      first() {
        this.b = 2;
        this.then.on({ reset: () => void order.push(`undo first b=${this.b}`) });
        this.second();
      }

      second() {
        this.c = 3;
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(order).toEqual(['undo first b=2', 'undo zero a=1']);
    expect(test.get()).toMatchObject({ a: 0, b: 0, c: 0 });
    expect(record(test).map((entry) => [entry.key, entry.on?.reset?.length, entry.unwound])).toEqual([
      ['run', undefined, undefined],
      ['zero', 1, true],
      ['first', 1, true],
      ['second', undefined, undefined]
    ]);
  });

  it('will restore a step without a compensation, not run', async () => {
    class Test extends Journal {
      kept = 0;
      value = 0;

      async run() {
        this.kept = 1;
        this.write();
      }

      protected async write() {
        this.value = 1;
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(test.get()).toMatchObject({ kept: 1, value: 0 });
    expect(record(test).map((entry) => [entry.id, entry.unwound])).toEqual([
      ['run#1', undefined],
      ['write#1', true],
      ['fail#1', undefined]
    ]);
  });

  it('will not mark a step which wrote nothing unwound', async () => {
    class Test extends Journal {
      async run() {
        this.idle();
      }

      protected async idle() {
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(record(test)[1].unwound).toBeUndefined();
  });

  it('will not roll back writes of a helper', async () => {
    class Test extends Steps {
      value = 0;
      count = 0;

      async run() {
        this.zero();
      }

      zero() {
        this.value = this._count();
        this.first();
      }

      first() {
        this._count();
        throw new Error('boom');
      }

      _count() {
        return ++this.count;
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(test.value).toBe(0);
    expect(test.count).toBe(2);
  });

  it('will unwind a branch which commits after another fails', async () => {
    const work = mockPromise();
    const undo = vi.fn();

    class Test extends Journal {
      value = 0;

      async run() {
        this.then(this.a(), this.b());
      }

      async a() {
        this.then.on({ reset: undo });
        await work;
        this.value = 1;
      }

      b() {
        work.resolve();
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(undo).toHaveBeenCalledWith();
    expect(test.value).toBe(0);
    expect(record(test).map((entry) => [entry.key, entry.unwound])).toEqual([
      ['run', undefined],
      ['b', undefined],
      ['a', true]
    ]);
  });

  it('will run steps a compensation calls as part of the unwind', async () => {
    const undo = vi.fn();

    class Test extends Journal {
      async run() {
        this.first();
      }

      async first() {
        this.then.on({
          reset: () => {
            this.release('r1');
          }
        });
        this.second();
      }

      second() {
        throw new Error('boom');
      }

      release(id: string) {
        undo(id);
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(undo).toHaveBeenCalledWith('r1');
    expect(record(test)[1].on?.reset).toEqual([{ id: 'then#1', key: 'then', args: [] }]);
    expect(ids(test)).toEqual(['run#1', 'first#1', 'second#1', 'release#1']);
  });

  it('will run what a compensation\'s steps schedule, groups included, before older compensations', async () => {
    const order: string[] = [];

    class Test extends Steps {
      async run() {
        this.first();
      }

      async first() {
        this.then.on({ reset: () => void order.push('first') });
        this.second();
      }

      async second() {
        this.then.on({
          reset: () => {
            this.refund();
          }
        });
        this.fail();
      }

      async fail() {
        throw new Error('boom');
      }

      async refund() {
        order.push('refund');
        this.then(this.notify('a'), this.notify('b'));
        this.log();
      }

      async notify(to: string) {
        order.push(`notify ${to}`);
      }

      async log() {
        order.push('log');
      }
    }

    await fails(Test, 'boom');
    expect(order).toEqual(['refund', 'notify a', 'notify b', 'log', 'first']);
  });

  it('will fail the unwind when a step a compensation calls throws', async () => {
    class Test extends Journal {
      async run() {
        this.first();
      }

      async first() {
        this.then.on({
          reset: () => {
            this.refund();
          }
        });
        this.fail();
      }

      async fail() {
        throw new Error('boom');
      }

      async refund() {
        throw new Error('refund failed');
      }
    }

    const [test] = await fails(Test, 'refund failed');

    expect(record(test)[1].unwound).toBe('failed');
  });

  it('will run compensations of one step newest first', async () => {
    const order: string[] = [];

    class Test extends Steps {
      async run() {
        this.first();
      }

      protected async first() {
        this.then.on({ reset: () => void order.push('a') });
        this.then.on({ reset: () => void order.push('b') });
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    await fails(Test, 'boom');
    expect(order).toEqual(['b', 'a']);
  });

  it('will compensate a step failing after it registered, on its own writes', async () => {
    const seen: number[] = [];

    class Test extends Journal {
      value = 0;
      other = 0;

      async run() {
        this.charge();
      }

      protected async charge() {
        this.then.on({
          reset: () => {
            seen.push(this.value);
            this.other = 5;
          }
        });
        this.value = 1;
        this.other = 1;
        await Promise.resolve();
        throw new Error('declined');
      }
    }

    const [test] = await fails(Test, 'declined');

    expect(seen).toEqual([1]);
    expect(test.get()).toMatchObject({ value: 0, other: 5 });
    expect(ids(test)).toEqual(['run#1', 'charge#1']);
  });

  it('will restore a step failing while the run ends before compensating it', async () => {
    const work = mockPromise();
    const seen: number[] = [];

    class Test extends Steps {
      value = 0;

      async run() {
        this.charge();
      }

      protected async charge() {
        this.then.on({ reset: () => void seen.push(this.value) });
        this.value = 1;
        await work;
        throw new Error('late');
      }
    }

    const [test, result] = await start(Test);

    test.then.end();
    work.resolve();

    await expect(result).rejects.toThrow('late');
    expect(seen).toEqual([0]);
    expect(test.value).toBe(0);
  });

  it('will see the unwound state and keep what it writes', async () => {
    class Test extends Journal {
      value = 0;
      notice = '';

      async run() {
        this.first();
      }

      protected async first() {
        this.value = 1;
        this.notice = 'placed';
        this.then.on({
          reset: () => {
            this.notice = `took back ${this.value}`;
          }
        });
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(test.get()).toMatchObject({ value: 0, notice: 'took back 1' });
  });

  it('will stop unwinding where a compensation throws', async () => {
    const order: string[] = [];

    class Test extends Journal {
      async run() {
        this.first();
      }

      first() {
        this.then.on({ reset: () => void order.push('undo first') });
        this.second();
      }

      second() {
        this.then.on({
          reset: () => {
            throw new Error('undo failed');
          }
        });
        this.third();
      }

      third() {
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'undo failed');

    expect(order).toEqual([]);
    expect(record(test).map((entry) => entry.unwound)).toEqual([undefined, undefined, 'failed', undefined]);
  });

  it('will not plan an end, gate or wait in a compensation', async () => {
    class Test extends Steps {
      async run(plan: (self: Test) => void) {
        this.first(plan);
      }

      first(plan: (self: Test) => void) {
        this.then.on({ reset: () => plan(this) });
        this.second();
      }

      second() {
        throw new Error('boom');
      }
    }

    await expect(Test.new().run((self) => self.then.end())).rejects.toThrow('end() cannot run in an undo.');
    await expect(Test.new().run((self) => self.then.only(1))).rejects.toThrow('a gate cannot run in an undo.');
    await expect(Test.new().run((self) => void self.then({ sec: 1 }))).rejects.toThrow('wait() cannot run in an undo.');
  });

  it('will throw for a compensation in run', async () => {
    class Test extends Steps {
      async run() {
        this.then.on({ reset: () => {} });
      }
    }

    await fails(Test, 'run cleans up in its tail - try/catch around await this.');
  });

  it('will throw for a handler not a step or function, or an unknown outcome', async () => {
    class Test extends Steps {
      async run(handlers: object) {
        this.first(handlers);
      }

      protected async first(handlers: object) {
        this.then.on(handlers as never);
      }
    }

    await expect(Test.new().run({ reset: 'x' })).rejects.toThrow('then.on() takes steps called for it - { reset: this.release(id) } - or a function.');
    await expect(Test.new().run({ finally: () => {} })).rejects.toThrow('then.on() takes reset, catch, abort and close - got finally.');
  });

  it('will throw for a compensation once settled', async () => {
    let held: Steps.Controller | undefined;

    class Test extends Steps {
      async run() {
        this.first();
      }

      protected async first() {
        held = this.then;
        this.second();
      }

      protected async second() {
        held!.on({ reset: () => {} });
      }
    }

    await fails(Test, 'first has settled; on cannot run.');
  });

  it('will keep a key an undo writes, even to the value it held', async () => {
    class Test extends Steps {
      value = 0;

      async run() {
        this.first();
      }

      protected async first() {
        this.value = 1;
        this.then.on({
          reset: () => {
            this.value = 1;
          }
        });
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(test.value).toBe(1);
  });

  it('will keep a key a step run by an undo writes', async () => {
    class Test extends Steps {
      notice = '';

      async run() {
        this.first();
      }

      protected async first() {
        this.notice = 'placed';
        this.then.on({ reset: this.note() });
        this.fail();
      }

      protected async note() {
        this.notice = 'taken back';
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(test.notice).toBe('taken back');
  });
});

describe('on', () => {
  class NoCourier extends Error {}

  function log(order: string[], name: string) {
    return {
      reset: () => void order.push(`reset ${name}`),
      abort: (error?: unknown) => void order.push(error ? `abort ${name}: ${(error as Error).name}` : `abort ${name}`),
      close: () => void order.push(`close ${name}`)
    };
  }

  it('will fire only close once the subtree completes', async () => {
    const order: string[] = [];

    class Test extends Steps {
      async run() {
        this.a();
        this.c();
      }

      protected a() {
        this.then.on(log(order, 'a'));
        this.b();
      }

      protected b() {
        order.push('b');
      }

      protected c() {
        order.push('c');
      }
    }

    await Test.new().run();
    expect(order).toEqual(['b', 'close a', 'c']);
  });

  it('will fire reset and close deepest first on a failure', async () => {
    const order: string[] = [];

    class Test extends Steps {
      async run() {
        this.z();
        this.a();
      }

      protected z() {
        this.then.on(log(order, 'z'));
      }

      protected a() {
        this.then.on(log(order, 'a'));
        this.b();
      }

      protected b() {
        this.then.on(log(order, 'b'));
        this.fail();
      }

      protected fail() {
        throw new Error('boom');
      }
    }

    await fails(Test, 'boom');
    expect(order).toEqual(['close z', 'abort b: Error', 'reset b', 'close b', 'abort a: Error', 'reset a', 'close a', 'reset z']);
  });

  it('will fire for the failing step itself', async () => {
    const order: string[] = [];

    class Test extends Steps {
      async run() {
        this.a();
      }

      protected a() {
        this.then.on(log(order, 'a'));
        throw new Error('own');
      }
    }

    await fails(Test, 'own');
    expect(order).toEqual(['abort a: Error', 'reset a', 'close a']);
  });

  it('will not undo above a catch which took it', async () => {
    const order: string[] = [];

    class Test extends Steps {
      async run() {
        this.a();
      }

      protected a() {
        this.then.on(log(order, 'a'));
        this.b().catch();
      }

      protected async b() {
        this.then.on(log(order, 'b'));
        this.fail();
      }

      protected fail() {
        throw new Error('boom');
      }
    }

    await Test.new().run();
    expect(order).toEqual(['abort b: Error', 'reset b', 'close b', 'close a']);
  });

  it('will abort with no error, then reset and close', async () => {
    const order: string[] = [];
    const work = mockPromise();

    class Test extends Steps {
      async run() {
        this.z();
        this.a();
      }

      protected z() {
        this.then.on(log(order, 'z'));
      }

      protected a() {
        this.then.on(log(order, 'a'));
        this.slow();
      }

      protected async slow() {
        await work;
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.then.active).toBe('slow'));
    test.then.abort();
    work.resolve();

    await expect(result).rejects.toMatchObject({ name: 'Aborted' });
    expect(order).toEqual(['close z', 'abort a', 'reset a', 'close a', 'reset z']);
  });

  it('will abort with no error on stop, resetting nothing', async () => {
    const order: string[] = [];
    const work = mockPromise();

    class Test extends Steps {
      async run() {
        this.z();
        this.a();
      }

      protected z() {
        this.then.on(log(order, 'z'));
      }

      protected a() {
        this.then.on(log(order, 'a'));
        this.slow();
      }

      protected async slow() {
        await work;
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.then.active).toBe('slow'));
    test.then.stop();
    work.resolve();

    await expect(result).rejects.toMatchObject({ name: 'Stopped' });
    expect(order).toEqual(['close z', 'abort a', 'close a']);
  });

  it('will abort and reset a racer which lost', async () => {
    const order: string[] = [];

    class Test extends Steps {
      async run() {
        this.then(this.reply, this.watch());
      }

      protected async watch() {
        this.then.on(log(order, 'watch'));
        this.then({ min: 1 });
      }

      reply() {}
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.then.waiting).toHaveLength(2));
    test.reply();
    await result;

    expect(order).toEqual(['abort watch', 'reset watch', 'close watch']);
  });

  it('will close an unfinished subtree when ended from outside, without abort', async () => {
    const order: string[] = [];
    const work = mockPromise();

    class Test extends Steps {
      async run() {
        this.a();
      }

      protected a() {
        this.then.on(log(order, 'a'));
        this.slow();
      }

      protected async slow() {
        await work;
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.then.active).toBe('slow'));
    test.then.end();
    work.resolve();

    await result;
    expect(order).toEqual(['close a']);
  });

  it('will run steps called for a handler, recorded with their args', async () => {
    const notes: string[] = [];

    class Test extends Journal {
      async run() {
        this.a();
      }

      protected a() {
        this.then.on({ close: [this.note('x'), this.note('y')], reset: undefined });
        this.b();
      }

      protected async b() {}

      protected async note(text: string) {
        notes.push(text);
      }
    }

    const [test] = await ran(Test);

    expect(notes).toEqual(['x', 'y']);
    expect(record(test)[1].on).toMatchObject({ close: [{ key: 'then', group: [{ key: 'note', args: ['x'] }, { key: 'note', args: ['y'] }] }] });
    expect(ids(test)).toEqual(['run#1', 'a#1', 'b#1', 'note#1', 'note#2']);
  });

  it('will fail the run if close throws', async () => {
    const work = mockPromise();

    class Clean extends Steps {
      async run() {
        this.a();
      }

      protected a() {
        this.then.on({ close: () => { throw new Error('close'); } });
      }
    }

    class Ended extends Steps {
      async run() {
        this.a();
      }

      protected a() {
        this.then.on({ close: () => { throw new Error('ended'); } });
        this.slow();
      }

      protected async slow() {
        await work;
      }
    }

    await fails(Clean, 'close');

    const caught = vi.fn();

    class Caught extends Steps {
      async run() {
        this.a().catch(caught);
      }

      protected async a() {
        this.then.on({ close: () => { throw new Error('caught'); } });
      }
    }

    await Caught.new().run();
    expect(caught).toHaveBeenCalledWith(new Error('caught'));

    const ended = Ended.new();
    const result = ended.run();

    await vi.waitFor(() => expect(ended.then.active).toBe('slow'));
    ended.then.end();
    work.resolve();

    await expect(result).rejects.toThrow('ended');
    expect(ended.then.status).toBe('failed');
  });

  it('will type outcomes', () => {
    class Test extends Steps {
      async run() {
        this.a();
      }

      protected a() {
        this.then.on({ reset: this.b(), catch: (error) => void error, close: [this.b(), this.b()] });
        // @ts-expect-error
        this.then.on({ finally: () => {} });
      }

      protected async b() {}
    }

    expect(Test.new().then.status).toBe('idle');
  });

  it('will take a step method with a narrowed parameter for catch and abort', () => {
    class Test extends Steps {
      async run() {
        this.a();
      }

      protected async a() {
        this.then.on({ catch: this.fallback, abort: this.failed });
      }

      protected async fallback(error: NoCourier) {
        void error;
      }

      protected async failed(error?: Error) {
        void error;
      }
    }

    expectTypeOf<Steps.On['catch']>().toEqualTypeOf<Steps.Handler | undefined>();
    expect(Test.new().then.status).toBe('idle');
  });

  it('will catch, then abort, reset and close a step whose catch passes the failure on', async () => {
    const order: string[] = [];

    class Test extends Journal {
      async run() {
        this.a();
      }

      protected async a() {
        this.then.on({
          catch: (error) => {
            order.push('catch');
            throw error;
          },
          abort: this.note('abort'),
          reset: () => void order.push('reset'),
          close: () => void order.push('close')
        });
        this.fail();
      }

      protected async note(text: string) {
        order.push(text);
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    await fails(Test, 'boom');
    expect(order).toEqual(['catch', 'abort', 'reset', 'close']);
  });
});

describe('on catch', () => {
  it('will recover a failure below, keeping the step and undoing what failed', async () => {
    const order: string[] = [];

    class Test extends Steps {
      kept = '';
      lost = '';

      async run() {
        this.a();
        this.c();
      }

      protected async a() {
        this.kept = 'a';
        this.then.on({
          catch: (error) => void order.push(`catch ${(error as Error).message}`),
          reset: () => void order.push('undo a'),
          close: () => void order.push('close a')
        });
        this.b();
      }

      protected async b() {
        this.lost = 'b';
        this.then.on({ reset: () => void order.push('undo b') });
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }

      protected async c() {
        order.push('c');
      }
    }

    const [test] = await ran(Test);

    expect(order).toEqual(['undo b', 'catch boom', 'close a', 'c']);
    expect(test.kept).toBe('a');
    expect(test.lost).toBe('');
    expect(test.then.status).toBe('idle');
  });

  it('will pass a rethrown failure to the caller\'s catch, inner first', async () => {
    const order: string[] = [];

    class Test extends Steps {
      async run() {
        this.a().catch((error) => void order.push(`caller ${(error as Error).message}`));
      }

      protected async a() {
        this.then.on({
          catch: (error) => {
            order.push('own');
            throw new Error(`${(error as Error).message} again`);
          },
          reset: () => void order.push('undo a')
        });
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    await Test.new().run();
    expect(order).toEqual(['own', 'undo a', 'caller boom again']);
  });

  it('will replay the step a catch belongs to', async () => {
    const tries: number[] = [];

    class Test extends Steps {
      async run() {
        this.a('x');
      }

      protected async a(arg: string) {
        tries.push(this.then.retried);
        this.then.on({
          catch: (error) => {
            if (this.then.retried >= 2) throw error;
            this.then.retry();
          }
        });
        this.fail(arg);
      }

      protected async fail(arg: string) {
        if (tries.length < 3) throw new Error(arg);
      }
    }

    await Test.new().run();
    expect(tries).toEqual([0, 1, 2]);
  });

  it('will schedule a step called for catch in place, without the error', async () => {
    const seen: unknown[] = [];

    class Test extends Journal {
      async run() {
        this.a();
      }

      protected async a() {
        this.then.on({ catch: this.fallback('b') });
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }

      protected async fallback(name: string) {
        seen.push(name);
      }
    }

    const [test] = await ran(Test);

    expect(seen).toEqual(['b']);
    expect(ids(test)).toEqual(['run#1', 'a#1', 'fail#1', 'fallback#1']);
  });

  it('will run a step method given for catch with the error, recorded', async () => {
    const seen: unknown[] = [];

    class Test extends Journal {
      async run(rethrow: boolean) {
        this.a(rethrow);
      }

      protected async a(rethrow: boolean) {
        this.then.on({ catch: rethrow ? this.passOn : this.fallback });
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }

      protected async fallback(error: unknown) {
        seen.push(error);
        this.later();
      }

      protected async passOn(error: unknown) {
        throw error;
      }

      protected async later() {
        seen.push('later');
      }
    }

    const [test] = await ran(Test, false);

    expect(seen).toEqual([new Error('boom'), 'later']);
    expect(record(test).find((entry) => entry.key == 'fallback')).toMatchObject({ args: [{ name: 'Error', message: 'boom' }] });

    await expect(Test.new().run(true)).rejects.toThrow('boom');
  });

  it('will not run catch once an undo below fails the run', async () => {
    const caught = vi.fn();

    class Test extends Steps {
      async run() {
        this.a();
      }

      protected async a() {
        this.then.on({ catch: caught });
        this.b();
      }

      protected async b() {
        this.then.on({
          reset: () => {
            throw new Error('undo');
          }
        });
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    await fails(Test, 'undo');
    expect(caught).not.toHaveBeenCalled();
  });

  it('will recover in an answer to a wait', async () => {
    const caught = vi.fn();

    class Test extends Steps {
      async run() {
        this.then(this.allow);
      }

      async allow() {
        this.then.on({ catch: caught });
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.then.status).toBe('waiting'));
    await test.allow();
    await result;
    expect(caught).toHaveBeenCalledWith(new Error('boom'));
  });

  it('will not see its step\'s throw before it was registered, or take two', async () => {
    const caught = vi.fn();

    class Before extends Steps {
      async run() {
        this.a();
      }

      protected async a() {
        throw new Error('early');
      }
    }

    class Twice extends Steps {
      async run() {
        this.a();
      }

      protected async a() {
        this.then.on({ catch: caught });
        this.then.on({ catch: caught });
      }
    }

    await fails(Before, 'early');
    await fails(Twice, 'then.on() takes one catch per step.');
    expect(caught).not.toHaveBeenCalled();
  });

  it('will recover its step\'s own body from registration on', async () => {
    const order: string[] = [];

    class Test extends Steps {
      value = 0;
      note = '';

      async run() {
        this.a();
        this.c();
      }

      protected async a() {
        this.value = 1;
        this.note = 'a';
        this.then.on({
          reset: () => {
            order.push('undo a');
            this.note = 'undone';
          },
          abort: () => void order.push('abort a'),
          close: () => void order.push('close a'),
          catch: (error) => {
            order.push(`catch ${(error as Error).message}`);
            this.b();
          }
        });
        throw new Error('own');
      }

      protected async b() {
        order.push('b');
      }

      protected async c() {
        order.push('c');
      }
    }

    const [test] = await ran(Test);

    expect(order).toEqual(['undo a', 'catch own', 'b', 'close a', 'c']);
    expect(test.value).toBe(0);
    expect(test.note).toBe('undone');
  });

  it('will show a catch of its own body the failed values, restoring them after', async () => {
    const seen: unknown[] = [];

    class Test extends Steps {
      value = 0;
      note = '';
      items = has<string>();

      async run(mode: string) {
        this.a(mode);
      }

      protected async a(mode: string) {
        this.value = 1;
        this.note = 'body';
        this.items.push('x');
        this.then.on({
          catch: () => {
            seen.push(this.value, this.items.size);

            if (mode == 'restore') {
              this.then.restore();
              seen.push(this.value, this.items.size);
            }

            if (mode == 'write') this.note = 'handler';
            if (mode == 'collection') this.items.push('y');
          }
        });
        throw new Error('own');
      }
    }

    const plain = Test.new();
    const restored = Test.new();
    const written = Test.new();

    await plain.run('plain');
    await restored.run('restore');
    await written.run('write');

    const [changed] = await ran(Test, 'collection');

    expect(seen).toEqual([1, 1, 1, 1, 0, 0, 1, 1, 1, 1]);
    expect([...changed.items]).toEqual(['x', 'y']);
    expect(plain.get()).toMatchObject({ value: 0, note: '' });
    expect(plain.items.size).toBe(0);
    expect(restored.get()).toMatchObject({ value: 0, note: '' });
    expect(written.get()).toMatchObject({ value: 0, note: 'handler' });
    expect(written.items.size).toBe(0);
  });

  it('will replay its step from a catch of its own body', async () => {
    const tries: number[] = [];
    const values: number[] = [];

    class Test extends Steps {
      value = 0;

      async run() {
        this.a('x');
      }

      protected async a(arg: string) {
        tries.push(this.then.retried);
        values.push(this.value);
        this.value++;
        this.then.on({
          catch: () => {
            this.then.retry();
          }
        });

        if (tries.length < 3) throw new Error(arg);
      }
    }

    const [test] = await ran(Test);

    expect(tries).toEqual([0, 1, 2]);
    expect(values).toEqual([0, 0, 0]);
    expect(test.value).toBe(1);
  });

  it('will fail the run if an undo throws resetting its own body', async () => {
    const caught = vi.fn();

    class Test extends Steps {
      async run() {
        this.a();
      }

      protected async a() {
        this.then.on({
          reset: () => {
            throw new Error('undo');
          },
          catch: caught
        });
        throw new Error('own');
      }
    }

    await fails(Test, 'undo');
    expect(caught).not.toHaveBeenCalled();
  });

  it('will fail the run if after throws on a failure its own catch takes', async () => {
    class Test extends Steps {
      async run() {
        this.a();
      }

      protected async a() {
        this.then.on({ catch: () => {} });
        throw new Error('own');
      }

      protected after(key: string, entry: Steps.Entry) {
        if (entry.error) throw new Error('after');
      }
    }

    await fails(Test, 'after');
  });

  it('will pass a rethrow of its own body on, aborting with the error', async () => {
    const order: string[] = [];

    class Test extends Steps {
      async run(caught: boolean) {
        if (caught) this.a().catch((error) => void order.push(`caller ${(error as Error).message}`));
        else this.a();
      }

      protected async a() {
        this.then.on({
          abort: (reason) => void order.push(`abort ${(reason as Error).message}`),
          close: () => void order.push('close'),
          catch: (error) => {
            throw error;
          }
        });
        throw new Error('own');
      }
    }

    await Test.new().run(true);
    await expect(Test.new().run(false)).rejects.toThrow('own');
    expect(order).toEqual(['abort own', 'close', 'caller own', 'abort own', 'close']);
  });

  it('will not catch a failure once the run is stopping', async () => {
    const caught = vi.fn();
    const work = mockPromise();

    class Test extends Steps {
      async run() {
        this.a();
      }

      protected async a() {
        this.then.on({ catch: caught });
        this.slow();
      }

      protected async slow() {
        await work;
        throw new Error('late');
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.then.active).toBe('slow'));
    test.then.stop();
    work.resolve();

    await expect(result).rejects.toMatchObject({ name: 'Stopped' });
    expect(caught).not.toHaveBeenCalled();
  });
});

describe('close', () => {
  it('will give abort the error of a failure, nothing for a cancellation', async () => {
    const seen: unknown[] = [];

    class Test extends Steps {
      async run(mode: string) {
        this.a(mode);
      }

      protected async a(mode: string) {
        this.then.on({ abort: (error) => void seen.push(error, this.then.status) });

        if (mode == 'fail') this.fail();
        if (mode == 'recover') this.b();
        if (mode == 'halt') this.slow();
      }

      protected async b() {
        this.then.on({ catch: () => {} });
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }

      protected async slow() {
        const { signal } = this.then;

        await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
      }
    }

    await Test.new().run('clean');
    await Test.new().run('recover');
    await expect(Test.new().run('fail')).rejects.toThrow('boom');

    for (const halt of ['abort', 'stop'] as const) {
      const test = Test.new();
      const result = test.run('halt');

      await vi.waitFor(() => expect(test.then.active).toBe('slow'));
      test.then[halt]();
      await result.catch(() => {});
    }

    expect(seen).toEqual([new Error('boom'), 'failed', undefined, 'aborted', undefined, 'stopped']);
  });
});

describe('irreversible', () => {
  class Item extends Model {
    name = '';
  }

  it('will stop the unwind at a removed pool member', async () => {
    const warn = mockWarn();

    class Test extends Journal {
      items = has(Item);
      value = 0;

      protected new() {
        this.items.add({ name: 'a' });
      }

      async run() {
        this.value = 1;
        this.drop();
      }

      protected async drop() {
        this.value = 2;
        this.items.clear();
        this.fail();
      }

      protected async fail() {
        this.value = 3;
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(test.value).toBe(2);
    expect(test.then.error).toEqual(new Error('boom'));
    expect(record(test).map((entry) => [entry.key, entry.irreversible, entry.halted, entry.unwound])).toEqual([
      ['run', undefined, undefined, undefined],
      ['drop', ['items'], true, undefined],
      ['fail', undefined, undefined, undefined]
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(`${test} stopped unwinding at drop#1: items cannot be restored.`);
  });

  it('will unwind steps after an irreversible one', async () => {
    mockWarn();

    class Test extends Journal {
      items = has(Item);
      value = 0;

      protected new() {
        this.items.add({ name: 'a' });
      }

      async run() {
        this.drop();
      }

      protected async drop() {
        this.items.clear();
        this.write();
      }

      protected async write() {
        this.value = 1;
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(test.value).toBe(0);
    expect(record(test).map((entry) => [entry.key, entry.unwound])).toEqual([
      ['run', undefined],
      ['drop', undefined],
      ['write', true],
      ['fail', undefined]
    ]);
  });

  it('will be reversible with a compensation of its own', async () => {
    const undo = vi.fn();

    class Test extends Journal {
      items = has(Item);
      values = map((key: string) => new Item({ name: key }));

      protected new() {
        this.items.add({ name: 'a' });
        this.values.set('a');
        this.values.set('c');
      }

      async run() {
        this.charge();
      }

      async charge() {
        this.then.on({ reset: undo });
        this.items.clear();
        this.values.delete('a');
        this.values.set('b');
        this.values.set('c');
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(undo).toHaveBeenCalledTimes(1);
    expect(test.items.size).toBe(0);
    expect([...test.values.keys()]).toEqual(['c']);
    expect(record(test)[1]).toMatchObject({ on: { reset: [{ id: 'then#1', key: 'then', args: [] }] }, unwound: true });
    expect(record(test)[1].irreversible).toBeUndefined();
  });

  it('will be irreversible when a map evicts an owned value', async () => {
    mockWarn();

    class Test extends Journal {
      values = map<string, Item>();

      protected new() {
        this.values.set('a', new Item({ name: 'a' }));
      }

      async run() {
        this.values.set('a', new Item({ name: 'b' }));
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(test.values.get('a')!.name).toBe('b');
    expect(record(test)[0]).toMatchObject({ irreversible: ['values'], halted: true });
  });

  it('will not catch an irreversible step', async () => {
    const warn = mockWarn();

    const attempt = vi.fn();

    class Test extends Journal {
      items = has(Item);
      value = 0;

      protected new() {
        this.items.add({ name: 'a' });
      }

      async run() {
        this.drop().catch(this.drop);
      }

      protected async drop() {
        attempt();
        this.value = 1;
        this.items.clear();
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(test.value).toBe(1);
    expect(ids(test)).toEqual(['run#1', 'drop#1']);
    expect(warn).toHaveBeenCalledWith(`${test} stopped unwinding at drop#1: items cannot be restored.`);
  });

  it('will keep the writes of a failing irreversible step', async () => {
    const warn = mockWarn();

    class Test extends Journal {
      items = has(Item);
      value = 0;

      protected new() {
        this.items.add({ name: 'a' });
      }

      async run() {
        this.value = 1;
        this.drop();
      }

      protected async drop() {
        this.value = 2;
        this.items.clear();
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(test.value).toBe(2);
    expect(record(test).map((entry) => [entry.key, entry.halted, entry.unwound])).toEqual([['run', undefined, undefined], ['drop', true, undefined]]);
    expect(warn).toHaveBeenCalledWith(`${test} stopped unwinding at drop#1: items cannot be restored.`);
  });
});

describe('commit', () => {
  it('will stop the unwind at a committed step', async () => {
    const warn = mockWarn();
    const refund = vi.fn();
    const recall = vi.fn();

    class Test extends Journal {
      charged = false;
      notified = false;

      async run() {
        this.pay();
      }

      protected async pay() {
        this.then.on({ reset: refund });
        this.then.commit();
        this.charged = true;
        this.notify();
      }

      protected async notify() {
        this.notified = true;
        this.then.on({ reset: recall });
        this.ship();
      }

      protected async ship() {
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(recall).toHaveBeenCalled();
    expect(refund).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(test.get()).toMatchObject({ charged: true, notified: false });
    expect(record(test).map((entry) => [entry.key, entry.committed, entry.halted, entry.unwound])).toEqual([
      ['run', undefined, undefined, undefined],
      ['pay', true, true, undefined],
      ['notify', undefined, undefined, true],
      ['ship', undefined, undefined, undefined]
    ]);
  });

  it('will not catch or restore a step failing after commit', async () => {
    const attempt = vi.fn();

    class Test extends Journal {
      value = 0;

      async run() {
        this.pay().catch(this.pay);
      }

      protected async pay() {
        attempt();
        this.value = 1;
        this.then.commit();
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(test.value).toBe(1);
    expect(ids(test)).toEqual(['run#1', 'pay#1']);
  });

  it('will throw if commit is called outside a step', () => {
    class Test extends Steps {
    }

    expect(() => Test.new().then.commit()).toThrow('commit must be called inside a step.');
  });

  it('will throw if commit is called after its step settled', async () => {
    let held!: Steps.Controller;

    class Test extends Steps {
      async run() {
        held = this.then;
        this.later();
      }

      protected later() {
        held.commit();
      }
    }

    await fails(Test, 'run has settled; commit cannot run.');
  });
});

describe('durable handlers', () => {
  it('will compensate with a step called for it, and keep working after', async () => {
    const released = vi.fn();

    class Test extends Journal {
      hold = '';

      async run() {
        this.reserve();
      }

      protected async reserve() {
        this.hold = 'h1';
        this.then.on({ reset: this.release('h1') });
        await Promise.resolve();
        this.hold = 'h2';
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }

      protected async release(hold: string) {
        released(hold, this.hold);
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(released).toHaveBeenCalledWith('h1', 'h2');
    expect(test.hold).toBe('');
    expect(record(test)[1]).toMatchObject({ next: [{ key: 'fail' }], on: { reset: [{ id: 'release#1', key: 'release', args: ['h1'] }] } });
    expect(ids(test)).toEqual(['run#1', 'reserve#1', 'fail#1', 'release#1']);
  });

  it('will run steps called for one compensation as a group', async () => {
    const order: string[] = [];

    class Test extends Journal {
      async run() {
        this.pay();
      }

      protected async pay() {
        this.then.on({ reset: [this.cancel('a'), this.refund('b')] });
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }

      protected async cancel(id: string) {
        order.push(`cancel ${id}`);
        await Promise.resolve();
        order.push('cancelled');
      }

      protected async refund(id: string) {
        order.push(`refund ${id}`);
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(order).toEqual(['cancel a', 'refund b', 'cancelled']);
    expect(record(test)[1].on?.reset).toMatchObject([{ key: 'then', group: [{ key: 'cancel' }, { key: 'refund' }] }]);
  });

  it('will give a step method its error, recorded durably', async () => {
    const seen = vi.fn();

    class Test extends Journal {
      async run() {
        this.pay().catch(this.note);
      }

      protected async pay() {
        throw new Error('boom', { cause: 'card' });
      }

      protected async note(error: unknown) {
        seen(error);
      }
    }

    const [test] = await ran(Test);

    expect(seen).toHaveBeenCalledWith(new Error('boom'));
    expect(record(test)[0].next).toEqual([{ id: 'pay#1', key: 'pay', args: [], rescue: 'note' }]);
    expect(record(test).at(-1)).toMatchObject({ id: 'note#1', args: [{ name: 'Error', message: 'boom', cause: 'card' }] });
  });

  it('will run a function reset only on unwind', async () => {
    const undo = vi.fn();

    class Test extends Steps {
      async run(fail: boolean) {
        this.pay(fail);
      }

      protected async pay(fail: boolean) {
        this.then.on({ reset: undo });

        if (fail) throw new Error('declined');
      }
    }

    const [test] = await ran(Test, false);

    expect(undo).not.toHaveBeenCalled();

    await expect(test.run(true)).rejects.toThrow('declined');
    expect(undo).toHaveBeenCalledWith();
  });

  it('will record a thrown value that is not an Error as is', async () => {
    const seen = vi.fn();

    class Test extends Steps {
      async run() {
        this.scan().catch(this.skip);
      }

      protected async scan() {
        throw 'down';
      }

      protected async skip(error: unknown) {
        seen(error);
      }
    }

    await Test.new().run();
    expect(seen).toHaveBeenCalledWith('down');
  });

  it('will keep a step scheduling after an undo claims its tokens', async () => {
    const order: string[] = [];

    class Test extends Steps {
      async run() {
        this.first();
      }

      protected async first() {
        this.second();
        this.then.on({ reset: this.undo() });
      }

      protected async second() {
        order.push('second');
      }

      protected async undo() {
        order.push('undo');
      }
    }

    await Test.new().run();
    expect(order).toEqual(['second']);
  });

  it('will keep a step working after an undo claims its tokens', async () => {
    const order: string[] = [];

    class Test extends Steps {
      async run() {
        this.first();
      }

      protected async first() {
        this.then.on({ reset: this.undo() });
        await Promise.resolve();
        order.push('worked');
        this.second();
      }

      protected async second() {
        order.push('second');
      }

      protected async undo() {
        order.push('undo');
      }
    }

    await Test.new().run();
    expect(order).toEqual(['worked', 'second']);
  });

  it('will give a function handler the failed step\'s retried count', async () => {
    const calls: unknown[][] = [];

    class Test extends Steps {
      async run() {
        this.visit('x').catch((error) => {
          calls.push([(error as Error).message, this.then.retried]);

          if (this.then.retried < 2) this.then.retry();
        });
      }

      protected async visit(site: string) {
        calls.push(['visit', this.then.retried]);
        this.scan(site);
      }

      protected async scan(site: string) {
        throw new Error(`${site} is down`);
      }
    }

    await Test.new().run();
    expect(calls).toEqual([['visit', 0], ['x is down', 0], ['visit', 1], ['x is down', 1], ['visit', 2], ['x is down', 2]]);
  });

  it('will throw for undo or catch steps not called for it', async () => {
    const errors: unknown[] = [];

    class Test extends Steps {
      async run() {
        this.first();
      }

      protected async first() {
        const tries = [
          () => this.then.on({ reset: [this.a(), (() => {}) as never] }),
          () => this.then.on({ reset: this.then({}) as never }),
          () => this.then.on(undefined as never),
          () => this.then.on({ reset: {} as never }),
          () => this.then.on({ reset: [this.a as never] }),
        ];

        for (const attempt of tries)
          try {
            attempt();
          } catch (error) {
            errors.push((error as Error).message);
          }
      }

      protected async a() {}
    }

    await Test.new().run().catch(() => {});

    const usage = 'then.on() takes steps called for it - { reset: this.release(id) } - or a function.';

    expect(errors).toEqual([
      'then.on() takes called steps or step references, not both.',
      'then() takes a duration of ms, sec, min, hr and day as numbers - got none.',
      usage,
      usage,
      usage
    ]);
  });

  it('will not register handlers in a handler step', async () => {
    class Test extends Steps {
      async run() {
        this.a();
      }

      protected async a() {
        this.then.on({ reset: this.undo() });
        this.fail();
      }

      protected async undo() {
        this.then.on({ close: () => {} });
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    await fails(Test, 'then.on() cannot run in a handler step - use try/finally inside it.');
  });
});

describe('recover', () => {
  class NoCourier extends Error {}

  it('will recover where a typed failure is caught', async () => {
    const refund = vi.fn();
    const release = vi.fn();

    class Test extends Journal {
      hold = '';
      charge = '';
      notice = '';

      async run() {
        this.reserve();
      }

      protected async reserve() {
        this.hold = 'h1';
        this.then.on({ reset: release });
        this.pay().catch(this.recover);
      }

      protected async recover(error: unknown) {
        if (!(error instanceof NoCourier)) throw error;

        this.notice = 'backordered';
        this.backorder();
      }

      protected async pay() {
        this.charge = 'c1';
        this.then.on({ reset: refund });
        this.ship();
      }

      protected async ship() {
        throw new NoCourier('no courier');
      }

      protected async backorder() {}
    }

    const [test] = await ran(Test);

    expect(refund).toHaveBeenCalledWith();
    expect(release).not.toHaveBeenCalled();
    expect(test.get()).toMatchObject({ hold: 'h1', charge: '', notice: 'backordered' });
    expect(record(test).map((entry) => [entry.id, entry.unwound, (entry.error as Error)?.message])).toEqual([
      ['run#1', undefined, undefined],
      ['reserve#1', undefined, undefined],
      ['pay#1', true, undefined],
      ['ship#1', undefined, 'no courier'],
      ['recover#1', undefined, undefined],
      ['backorder#1', undefined, undefined]
    ]);
  });

  it('will run a handler on the failed state and restore before what it schedules', async () => {
    const seen: number[] = [];

    class Test extends Steps {
      value = 0;

      async run() {
        this.first().catch(this.handle);
      }

      protected async first() {
        this.value = 1;
        this.second();
      }

      protected async second() {
        throw new Error('boom');
      }

      protected async handle() {
        seen.push(this.value);
        this.next();
      }

      protected async next() {
        seen.push(this.value);
      }
    }

    await Test.new().run();
    expect(seen).toEqual([1, 0]);
  });

  it('will keep keys a handler writes', async () => {
    class Test extends Steps {
      value = 0;
      other = 0;

      async run() {
        this.first().catch(this.handle);
      }

      protected async first() {
        this.value = 1;
        this.other = 1;
        this.second();
      }

      protected async second() {
        throw new Error('boom');
      }

      protected async handle() {
        this.value = 5;
      }
    }

    const [test] = await ran(Test);

    expect(test.get()).toMatchObject({ value: 5, other: 0 });
  });

  it('will restore the branch on reset, keeping writes after it', async () => {
    const seen: number[] = [];

    class Test extends Steps {
      value = 0;
      other = 0;

      async run() {
        this.first().catch(this.handle);
      }

      protected async first() {
        this.value = 1;
        this.other = 1;
        this.second();
      }

      protected async second() {
        throw new Error('boom');
      }

      protected async handle() {
        this.value = 7;
        this.then.restore();
        seen.push(this.value, this.other);
        this.other = 9;
      }
    }

    const [test] = await ran(Test);

    expect(seen).toEqual([0, 0]);
    expect(test.get()).toMatchObject({ value: 0, other: 9 });
  });

  it('will restore collections a handler leaves alone', async () => {
    class Test extends Steps {
      items = has<string>();
      kept = has<string>();

      async run() {
        this.first().catch(this.handle);
      }

      protected async first() {
        this.items.push('a');
        this.kept.push('b');
        this.second();
      }

      protected async second() {
        throw new Error('boom');
      }

      protected async handle() {
        this.kept.push('c');
      }
    }

    const [test] = await ran(Test);

    expect(test.items.get()).toEqual([]);
    expect(test.kept.get()).toEqual(['b', 'c']);
  });

  it('will reset collections too', async () => {
    class Test extends Steps {
      items = has<string>();

      async run() {
        this.first().catch(this.handle);
      }

      protected async first() {
        this.items.push('a');
        this.second();
      }

      protected async second() {
        throw new Error('boom');
      }

      protected async handle() {
        this.items.push('b');
        this.then.restore();
      }
    }

    const [test] = await ran(Test);

    expect(test.items.get()).toEqual(['b']);
  });

  it('will restore what a handler wrote to before the branch when unwound again', async () => {
    class Test extends Steps {
      value = 0;

      async run() {
        this.outer().catch();
      }

      protected async outer() {
        this.inner().catch(this.handle);
      }

      protected async inner() {
        this.value = 1;
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }

      protected async handle() {
        this.value = 2;
        this.later();
      }

      protected async later() {
        throw new Error('again');
      }
    }

    const [test] = await ran(Test);

    expect(test.value).toBe(0);
  });

  it('will restore the branch when a handler fails', async () => {
    class Test extends Steps {
      value = 0;

      async run() {
        this.first().catch(this.handle);
      }

      protected async first() {
        this.value = 1;
        this.second();
      }

      protected async second() {
        throw new Error('boom');
      }

      protected async handle(error: unknown) {
        this.value = 2;
        throw error;
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(test.value).toBe(0);
  });

  it('will throw for reset outside a handler', async () => {
    class Test extends Steps {
      async run() {
        this.first();
      }

      protected async first() {
        this.then.restore();
      }
    }

    await fails(Test, 'restore() must be called in a .catch handler.');
  });

  it('will abort and compensate parallel steps a caught failure discards', async () => {
    const mailed = mockPromise();
    const signals: AbortSignal[] = [];
    const recall = vi.fn();
    const unnotify = vi.fn();

    class Test extends Journal {
      async run() {
        this.pay().catch();
      }

      async pay() {
        this.then(this.ship(), this.receipt(), this.notify());
      }

      async ship() {
        await Promise.resolve();
        throw new Error('no courier');
      }

      async receipt() {
        this.then.on({ reset: recall });
        signals.push(this.then.signal);
        await mailed;
      }

      async notify() {
        const { signal } = this.then;

        this.then.on({ reset: unnotify });
        await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(signals[0]?.aborted).toBe(true));
    mailed.resolve();

    await result;
    expect(recall).toHaveBeenCalledWith();
    expect(unnotify).toHaveBeenCalledWith();
    expect(record(test).map((entry) => [entry.id, entry.unwound])).toEqual([
      ['run#1', undefined],
      ['pay#1', undefined],
      ['ship#1', undefined],
      ['receipt#1', true]
    ]);
  });

  it('will release a wait opened by a step a caught failure discards', async () => {
    class Test extends Journal {
      async run() {
        this.then(this.ask(), this.cancel()).catch();
      }

      ask() {
        this.then(this.answer);
      }

      async cancel() {
        await Promise.resolve();
        throw new Error('cancel');
      }

      answer() {}
    }

    const [test] = await ran(Test);

    expect(test.answer).toBeUndefined();
    expect(ids(test)).toEqual(['run#1', 'ask#1', 'cancel#1']);
  });

  it('will halt at a committed step and continue the run', async () => {
    const refund = vi.fn();
    const recall = vi.fn();

    class Test extends Journal {
      async run() {
        this.pay().catch();
      }

      async pay() {
        this.then.on({ reset: refund });
        this.then.commit();
        this.notify();
      }

      async notify() {
        this.then.on({ reset: recall });
        this.ship();
      }

      async ship() {
        throw new Error('boom');
      }
    }

    const [test] = await ran(Test);

    expect(recall).toHaveBeenCalledTimes(1);
    expect(refund).not.toHaveBeenCalled();
    expect(record(test).map((entry) => [entry.id, entry.halted, entry.unwound])).toEqual([
      ['run#1', undefined, undefined],
      ['pay#1', true, undefined],
      ['notify#1', undefined, true],
      ['ship#1', undefined, undefined]
    ]);
  });

  it('will halt at an irreversible step and continue the run', async () => {
    const warn = mockWarn();

    class Item extends Model {}

    class Test extends Journal {
      items = has(Item);

      protected new() {
        this.items.add({});
      }

      async run() {
        this.drop().catch();
      }

      async drop() {
        this.items.clear();
        this.first();
      }

      async first() {
        throw new Error('boom');
      }
    }

    const [test] = await ran(Test);

    expect(test.then.status).toBe('idle');
    expect(warn).toHaveBeenCalledWith(`${test} stopped unwinding at drop#1: items cannot be restored.`);
    expect(record(test).map((entry) => [entry.id, entry.halted])).toEqual([
      ['run#1', undefined],
      ['drop#1', true],
      ['first#1', undefined]
    ]);
  });

  it('will wait for an outside call to retry', async () => {
    const refund = vi.fn();

    class Test extends Journal {
      card = '';
      tracking = '';

      async run() {
        this.pay('card1').catch(this.declined);
      }

      async pay(card: string) {
        this.card = card;
        this.then.on({ reset: () => refund(card) });
        this.ship();
      }

      async ship() {
        if (this.card == 'card1') throw new Error('declined');

        this.tracking = `trk_${this.card}`;
      }

      protected declined() {
        this.then(this.pay);
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.pay).toBeDefined());
    expect(refund).toHaveBeenCalledWith('card1');
    expect(test.card).toBe('');
    expect(test.then.waiting).toEqual([{ id: 'wait#1', step: 'declined', args: [{ name: 'Error', message: 'declined' }], answers: ['pay'] }]);

    await test.pay('card2');
    await result;

    expect(test.get()).toEqual({ card: 'card2', tracking: 'trk_card2' });
    expect(record(test).map((entry) => [entry.id, entry.wake, entry.unwound])).toEqual([
      ['run#1', undefined, undefined],
      ['pay#1', undefined, true],
      ['ship#1', undefined, undefined],
      ['declined#1', undefined, undefined],
      ['pay#2', 'wait#1', undefined],
      ['ship#2', undefined, undefined]
    ]);
  });

  it('will not compensate a step twice when a handler rethrows', async () => {
    const undo = vi.fn();

    class Test extends Steps {
      async run() {
        this.outer().catch(this.rethrow);
      }

      protected async outer() {
        this.then.on({ reset: undo });
        this.inner();
      }

      protected async inner() {
        throw new Error('boom');
      }

      protected async rethrow(error: unknown) {
        throw error;
      }
    }

    await fails(Test, 'boom');
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('will unwind parallel caught branches one at a time', async () => {
    const order: string[] = [];

    class Test extends Steps {
      async run() {
        this.then(this.side('l').catch(), this.side('r').catch());
      }

      protected async side(name: string) {
        this.then.on({
          reset: async () => {
            order.push(`${name} start`);
            await Promise.resolve();
            await Promise.resolve();
            order.push(`${name} end`);
          }
        });
        await Promise.resolve();
        throw new Error(name);
      }
    }

    await Test.new().run();
    expect(order).toEqual(['l start', 'l end', 'r start', 'r end']);
  });

  it('will fail when a caught branch\'s compensation throws and stop the run\'s unwind there', async () => {
    const undo = vi.fn();

    class Test extends Journal {
      async run() {
        this.first();
      }

      async first() {
        this.then.on({ reset: undo });
        this.second().catch();
      }

      async second() {
        this.then.on({
          reset: () => {
            throw new Error('undo');
          }
        });
        this.third();
      }

      async third() {
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'undo');

    expect(undo).not.toHaveBeenCalled();
    expect(record(test).map((entry) => [entry.id, entry.unwound])).toEqual([
      ['run#1', undefined],
      ['first#1', undefined],
      ['second#1', 'failed'],
      ['third#1', undefined]
    ]);
  });

  it('will stop unwinding between compensations when stopped', async () => {
    const refunded = mockPromise();
    const undo = vi.fn();

    class Test extends Journal {
      async run() {
        this.zero().catch();
      }

      async zero() {
        this.then.on({ reset: undo });
        this.first();
      }

      async first() {
        this.then.on({ reset: () => refunded });
        this.second();
      }

      async second() {
        throw new Error('boom');
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(record(test).at(-1)?.id).toBe('second#1'));
    test.then.stop();
    refunded.resolve();

    await expect(result).rejects.toMatchObject({ name: 'Stopped' });
    expect(undo).not.toHaveBeenCalled();
    expect(record(test).map((entry) => [entry.id, entry.unwound])).toEqual([
      ['run#1', undefined],
      ['zero#1', undefined],
      ['first#1', true],
      ['second#1', undefined]
    ]);
  });

  it('will stop unwinding when ended from outside', async () => {
    const work = mockPromise();
    const undo = vi.fn();

    class Test extends Journal {
      async run() {
        this.first().catch();
      }

      async first() {
        this.then.on({ reset: undo });
        this.then(this.slow(), this.quick());
      }

      async slow() {
        await work;
      }

      async quick() {
        await Promise.resolve();
        throw new Error('boom');
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(record(test).at(-1)?.id).toBe('quick#1'));
    test.then.end();
    work.resolve();

    await result;
    expect(test.then.status).toBe('idle');
    expect(undo).not.toHaveBeenCalled();
  });

  it('will not leave an answer promise rejecting unhandled', async () => {
    const caught = mockUncaught();

    class Test extends Steps {
      async run() {
        this.then(this.abort);
      }

      abort() {
        throw new Error('abort');
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.abort).toBeDefined());
    test.abort();

    await expect(result).rejects.toThrow('abort');
    await flushMicrotasks();
    expect(caught).toEqual([]);
  });
});

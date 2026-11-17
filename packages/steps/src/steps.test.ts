import { Component, Context, set, Model } from '@expressive/mvc';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { fails, flushMicrotasks, ids, Journal, mockPromise, mockUncaught, ran, record, start } from '../test.setup';
import { accept } from '@expressive/mvc/hot';

import { Steps } from './steps';

describe('steps', () => {
  it('will run steps from run through to its result', async () => {
    const order: string[] = [];

    class Test extends Journal {
      total = 0;

      async run(seed: number) {
        order.push(`run:${seed}`);
        this.first(seed + 1);

        await this;

        order.push(`result:${this.total}`);
        return this.total * 10;
      }

      async first(n: number) {
        order.push(`first:${n}`);
        this.second(n + 1);
      }

      second(n: number) {
        order.push(`second:${n}`);
        this.total = n;
      }
    }

    const test = Test.new();

    expect(test.then.self).toBe(test);
    expect(test.then.status).toBe('idle');
    expect(order).toEqual([]);

    expect(await test.run(1)).toBe(30);
    expect(order).toEqual(['run:1', 'first:2', 'second:3', 'result:3']);
    expect(test.then.status).toBe('idle');
    expect(record(test)).toEqual([
      { id: 'run#1', key: 'run', args: [1], wrote: [], next: [{ id: 'first#1', key: 'first', args: [2] }] },
      { id: 'first#1', key: 'first', args: [2], wrote: [], next: [{ id: 'second#1', key: 'second', args: [3] }] },
      { id: 'second#1', key: 'second', args: [3], wrote: ['total'], next: [] }
    ]);
  });

  it('will not touch the prototype', () => {
    class Test extends Steps {
      async run() {}
    }

    Test.new();

    const before = Object.getOwnPropertyDescriptor(Test.prototype, 'run');
    const test = Test.new();
    const own = Object.getOwnPropertyDescriptor(test, 'run')!;

    expect(Object.getOwnPropertyDescriptor(Test.prototype, 'run')).toEqual(before);
    expect(own.enumerable).toBe(false);
    expect(Object.keys(test)).not.toContain('run');
  });

  it('will not wrap new or getters', async () => {
    class Test extends Steps {
      value = 2;
      ready = false;

      get double() {
        return this.value * 2;
      }

      protected new() {
        this.ready = true;
      }

      async run() {
        this.value = this.double;
      }
    }

    const test = Test.new();

    expect(test.ready).toBe(true);
    await test.run();
    expect(test.get()).toEqual({ value: 4, ready: true, double: 8 });
  });

  it('will invoke the next step only after the current one settles', async () => {
    const work = mockPromise();
    const second = vi.fn();

    class Test extends Steps {
      async run() {
        this.first();
      }

      async first() {
        await work;
        this.second();
      }

      second() {
        second();
      }
    }

    const test = Test.new();

    test.run();
    await flushMicrotasks();
    expect(second).not.toHaveBeenCalled();
    expect(test.then.active).toBe('first');

    work.resolve();
    await test;
    expect(second).toHaveBeenCalledTimes(1);
    expect(test.then.active).toBeUndefined();
  });

  it('will run steps in sequence, each through what it schedules', async () => {
    const order: string[] = [];

    class Test extends Steps {
      async run() {
        this.a();
        this.b();
      }

      async a() {
        order.push('a');
        await flushMicrotasks();
        order.push('a!');
        this.a1();
      }

      a1() {
        order.push('a1');
      }

      b() {
        order.push('b');
      }
    }

    await Test.new().run();
    expect(order).toEqual(['a', 'a!', 'a1', 'b']);
  });

  it('will not run a step awaited inside a step', async () => {
    const order: string[] = [];

    class Test extends Steps {
      async run() {
        await this.a();
        order.push('run');
        this.b();
      }

      a() {
        order.push('a');
      }

      b() {
        order.push('b');
      }
    }

    await Test.new().run();
    expect(order).toEqual(['run', 'a', 'b']);
  });

  it('will loop by scheduling a step again', async () => {
    class Test extends Journal {
      count = 0;

      async run(until: number) {
        this.tick(until);
      }

      async tick(until: number) {
        let done = this.count == until;

        if (done) return;

        this.count++;
        this.tick(until);
      }
    }

    const [test] = await ran(Test, 3);

    expect(test.count).toBe(3);
    expect(ids(test)).toEqual(['run#1', 'tick#1', 'tick#2', 'tick#3', 'tick#4']);
  });

  it('will throw if a step calls run', async () => {
    class Test extends Steps {
      async run() {
        this.again();
      }

      async again() {
        this.run();
      }
    }

    await fails(Test, 'run is the entry - loop with a step: a step which schedules itself again.');
  });

  it('will record which fields each step wrote', async () => {
    class Test extends Journal {
      a = 0;
      b = '';

      async run() {
        this.a = 1;
        this.first();
      }

      first() {
        this.b = 'x';
        this.a = 2;
        this.a = 3;
      }
    }

    const [test] = await ran(Test);

    expect(record(test).map((entry) => entry.wrote)).toEqual([['a'], ['b', 'a']]);
    expect(record(test).some((entry) => 'prior' in entry || 'patch' in entry)).toBe(false);
  });

  it('will bind Model methods to the instance', async () => {
    let values: Record<string, unknown> | undefined;

    class Test extends Steps {
      value = 1;

      async run() {
        values = this.get();

        await this;

        return String(this);
      }
    }

    const test = Test.new();

    expect(await test.run()).toBe(String(test));
    expect(values).toMatchObject({ value: 1 });
  });

  it('will run helpers on the instance', async () => {
    let self: unknown;

    class Test extends Journal {
      value = 0;

      async run() {
        this.value = this._double(2);
      }

      _double(n: number) {
        self = this;
        return n * 2;
      }
    }

    const [test] = await ran(Test);

    expect(test.value).toBe(4);
    expect(self).toBe(test);
    expect(record(test)[0].wrote).toEqual(['value']);
  });

  it('will not journal writes of a helper', async () => {
    class Test extends Journal {
      value = 0;
      label = '';

      async run() {
        this.value = this._double(2);
      }

      _double(n: number) {
        this.label = 'doubled';
        return n * 2;
      }
    }

    const [test] = await ran(Test);

    expect(test.get()).toEqual({ value: 4, label: 'doubled' });
    expect(record(test)[0].wrote).toEqual(['value']);
  });

  it('will pass function fields through', async () => {
    const fn = () => 1;
    let seen: unknown;

    class Test extends Steps {
      fn = fn;

      async run() {
        seen = this.fn;
      }
    }

    await Test.new().run();
    expect(seen).toBe(fn);
  });

  it('will accept writes from outside', async () => {
    class Test extends Journal {
      mode = 'ask';

      async run() {
        this.pause();

        await this;

        return this.mode;
      }

      protected async pause() {
        await flushMicrotasks();
      }
    }

    const test = Test.new();
    const result = test.run();

    test.mode = 'yolo';

    expect(await result).toBe('yolo');
    expect(record(test).map((entry) => entry.wrote)).toEqual([[], []]);
  });

  it('will type the result from run', async () => {
    class Test extends Steps {
      n = 0;

      async run(n: number) {
        this.store(n);

        await this;

        return { n: this.n };
      }

      protected async store(n: number) {
        this.n = n;
      }
    }

    const test = Test.new();
    const called = test.run(1);

    expectTypeOf(called).toEqualTypeOf<Promise<{ n: number }>>();
    expect(await called).toEqual({ n: 1 });

    test.run(2);

    const joined = await test;

    expectTypeOf(joined).toEqualTypeOf<{ n: number }>();
    expect(joined).toEqual({ n: 2 });
  });

  it('will type a result returned without awaiting the run', async () => {
    class Test extends Steps {
      async run() {
        return 'now';
      }
    }

    const result = await Test.new();

    expectTypeOf(result).toEqualTypeOf<string>();
    expect(result).toBe('now');
  });

  it('will type a caught failure as a result', async () => {
    class Test extends Steps {
      async run() {
        this.fail();

        try {
          await this;
        } catch {
          return { failed: true as const };
        }

        return { failed: false as const };
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    const test = Test.new();
    const result = await test.run();

    expectTypeOf(result).toEqualTypeOf<{ failed: true } | { failed: false }>();
    expect(result).toEqual({ failed: true });
    expect(test.then.status).toBe('failed');
    expect(test.then.error).toEqual(new Error('boom'));
  });

  it('will type then read in the body of run', async () => {
    class Test extends Steps {
      async run() {
        let idle = this.then.status == 'idle';

        await this;

        return idle;
      }
    }

    const result = await Test.new();

    expectTypeOf(result).toEqualTypeOf<boolean>();
    expect(result).toBe(false);
  });

  it('will fail if run awaits other work before its run', async () => {
    class Test extends Steps {
      async run() {
        await new Promise((resolve) => setTimeout(resolve));
        this.first();

        await this;

        return 'done';
      }

      protected async first() {}
    }

    await fails(Test, 'run awaited work before its plan - it takes arguments, calls steps and awaits this.');
  });

  it('will fail if run awaits other work and returns', async () => {
    class Test extends Steps {
      async run() {
        await new Promise((resolve) => setTimeout(resolve));

        return 'done';
      }
    }

    await fails(Test, 'run awaited work before its plan - it takes arguments, calls steps and awaits this.');
  });

  it('will reject with what run throws after its run', async () => {
    class Test extends Steps {
      async run() {
        this.first();

        await this;

        throw new Error('tail');
      }

      protected async first() {}
    }

    const [test] = await fails(Test, 'tail');

    expect(test.then.status).toBe('failed');
    expect(test.then.error).toEqual(new Error('tail'));
  });

  it('will not type a result read from awaiting the run', () => {
    class Test extends Steps {
      // @ts-expect-error - its type would come from its own return: TS7023
      async run() {
        const prior = await this;

        return prior;
      }
    }

    void Test;
  });

  it('will resolve context and owner from inside a step', async () => {
    const found: Model[] = [];

    class Service extends Model {}

    class Test extends Steps {
      async run() {
        found.push(this.get(Service), this.get(Model));
      }
    }

    class Host extends Model {
      service = new Service();
      test = new Test();
    }

    const host = Host.new();

    new Context(host);
    await host.test.run();

    expect(found[0]).toBe(host.service);
    expect(found[1]).toBe(host);
  });

  it('will run under a component its host has not committed', async () => {
    const statuses: string[] = [];
    const placed = mockPromise<void>();

    class Test extends Steps {
      async run() {}
    }

    class Host extends Component {
      test = new Test();
    }

    const stop = Component.on({ setup: () => placed });
    const host = Host.new();

    stop();

    host.test.get((self) => void statuses.push(self.then.status));

    await host.test.run();
    expect(host.test.then.runs).toBe(1);
    expect(statuses).toEqual([]);

    placed.resolve();
    await flushMicrotasks();

    expect(statuses).toEqual(['idle']);
  });
});

describe('end', () => {
  it('will pass an end to after, not an implicit one', async () => {
    const seen: string[] = [];

    class Test extends Steps {
      cut = false;

      async run() {
        this.first();
      }

      protected async first() {
        if (this.cut) this.then.end();
      }

      protected after(step: string) {
        seen.push(step);
      }
    }

    const [test] = await ran(Test);

    expect(seen).toEqual(['run', 'first']);

    seen.length = 0;
    test.cut = true;

    await test.run();
    expect(seen).toEqual(['run', 'first', 'end']);
  });

  it('will fail the run when after throws on end', async () => {
    class Test extends Steps {
      async run() {
        this.then.end();
      }

      protected after(step: string) {
        if (step == 'end') throw new Error('after end');
      }
    }

    await fails(Test, 'after end');
  });

  it('will end at its place and drop what is left', async () => {
    const order: string[] = [];

    class Test extends Journal {
      reason = '';

      async run() {
        this.a();
        this.b();
        this.c();

        await this;

        order.push('result');
        return this.reason;
      }

      a() {
        order.push('a');
      }

      b() {
        order.push('b');
        this.reason = 'early';
        this.b1();
        this.then.end();
      }

      b1() {
        order.push('b1');
      }

      c() {
        order.push('c');
      }
    }

    const test = Test.new();

    expect(await test.run()).toBe('early');
    expect(order).toEqual(['a', 'b', 'b1', 'result']);
    expect(ids(test)).toEqual(['run#1', 'a#1', 'b#1', 'b1#1', 'end#1']);
  });

  it('will fail if a class declares end', () => {
    class Test extends Steps {
      async run() {}

      end() {}
    }

    expect(() => new Test()).toThrow('Test declares end; return the result from run, end early with this.then.end().');
  });

  it('will fail if a class declares a name plan tokens use', () => {
    class Gate extends Steps {
      async run() {}

      protected async gate() {}
    }

    class Wait extends Steps {
      async wait() {}
    }

    expect(() => new Gate()).toThrow('Gate declares gate; then, end, gate and wait name plan tokens - rename the step.');
    expect(() => new Wait()).toThrow('Wait declares wait; then, end, gate and wait name plan tokens - rename the step.');
  });

  it('will fail if a step is called after end', async () => {
    const a = vi.fn();

    class Test extends Steps {
      async run() {
        this.then.end();
        this.a();
      }

      a() {
        a();
      }
    }

    await fails(Test, 'end must be the last call in a step.');
    expect(a).not.toHaveBeenCalled();
  });

  it('will keep a compensation registered before end', async () => {
    const refund = vi.fn();

    class Test extends Journal {
      paid = false;

      async run(fail: boolean) {
        this.pay(fail);

        await this;

        return this.paid ? 'paid' : 'unpaid';
      }

      pay(fail: boolean) {
        if (fail) throw new Error('declined');

        this.paid = true;
        this.then.on({ reset: this.refund() });
        this.then.end();
      }

      async refund() {
        refund();
      }
    }

    const test = Test.new();

    expect(await test.run(false)).toBe('paid');
    expect(refund).not.toHaveBeenCalled();
    expect(record(test)[1]).toMatchObject({ id: 'pay#1', next: [{ id: 'end#1', key: 'end' }], on: { reset: [{ id: 'refund#1', key: 'refund' }] } });
  });

  it('will end with the first end the plan reaches', async () => {
    const slow = mockPromise();
    const after = vi.fn();

    class Test extends Journal {
      winner = '';

      async run() {
        this.then(this.fast(), this.slow());

        await this;

        return this.winner;
      }

      async fast() {
        this.winner = 'fast';
        this.then.end();
      }

      async slow() {
        await slow;
        this.more();
        this.then.end();
      }

      more() {
        after();
      }
    }

    const [test, result] = await start(Test);

    slow.resolve();

    expect(await result).toBe('fast');
    expect(after).not.toHaveBeenCalled();
    expect(ids(test)).toEqual(['run#1', 'fast#1', 'slow#1', 'end#1']);
  });

  it('will resolve with nothing when run returns nothing', async () => {
    class Test extends Steps {
      count = 0;

      async run() {
        this.count = 1;
      }
    }

    const test = Test.new();

    expect(await test.run()).toBeUndefined();
    expect(test.count).toBe(1);
  });

  it('will not call hooks for an implicit end', async () => {
    const after = vi.fn();

    class Test extends Steps {
      async run() {}

      protected after(step: string) {
        after(step);
      }
    }

    await Test.new().run();
    expect(after.mock.calls).toEqual([['run']]);
  });

  it('will end from the controller', async () => {
    class Test extends Steps {
      count = 0;

      async run() {
        this.first();

        await this;

        return this.count;
      }

      async first() {
        this.count = 1;
        this.then.end();
      }
    }

    expect(await Test.new().run()).toBe(1);
  });

  it('will fail if end is called twice in a step', async () => {
    class Test extends Steps {
      async run() {
        this.then.end();
        this.then.end();
      }
    }

    await fails(Test, 'end must be the last call in a step.');
  });

  it('will do nothing if ended from outside while idle', () => {
    class Test extends Steps {
    }

    const test = Test.new();

    test.then.end();

    expect(test.then.status).toBe('idle');
    expect(test.then.runs).toBe(0);
  });

  it('will end from outside once steps in flight settle', async () => {
    const work = mockPromise();
    const more = mockPromise();
    const later = vi.fn();

    class Test extends Journal {
      value = 0;

      async run(work: Promise<void>) {
        this.load(work);

        await this;

        return `ended:${this.value}`;
      }

      protected async load(work: Promise<void>) {
        await work;
        this.value = 1;
        this.later();
      }

      async later() {
        later();
      }
    }

    const test = Test.new();
    const result = test.run(work);
    const queued = test.run(more);

    await flushMicrotasks();
    test.then.end();
    test.then.end();
    expect(test.then.status).toBe('running');

    work.resolve();

    expect(await result).toBe('ended:1');
    expect(later).not.toHaveBeenCalled();
    expect(test.then.runs).toBe(1);

    await flushMicrotasks();
    expect(test.then.status).toBe('running');
    test.then.end();
    more.resolve();

    expect(await queued).toBe('ended:1');
    expect(ids(test)).toEqual(['run#1', 'load#1', 'end#1']);
  });

  it('will end from outside while waiting', async () => {
    class Test extends Steps {
      count = 1;

      async run() {
        this.then(this.reply);

        await this;

        return this.count;
      }

      async reply() {}
    }

    const test = Test.new();
    const first = test.run();

    await flushMicrotasks();
    expect(test.reply).toBeTypeOf('function');

    test.then.end();

    expect(test.reply).toBeUndefined();
    expect(test.then.waiting).toEqual([]);
    expect(await first).toBe(1);
  });

  it('will fail if a step in flight fails after an outside end', async () => {
    const work = mockPromise();

    class Test extends Steps {
      async run() {
        this.load();
      }

      protected async load() {
        await work;
        throw new Error('boom');
      }
    }

    const [test, result] = await start(Test);

    test.then.end();
    work.resolve();

    await expect(result).rejects.toThrow('boom');
    expect(test.then.status).toBe('failed');
  });

  it('will end gracefully - what runs finishes, what it schedules is dropped', async () => {
    const work = mockPromise();
    const order: string[] = [];
    let signal!: AbortSignal;

    class Test extends Journal {
      value = 0;

      async run() {
        this.then(this.slow(), this.stop());

        await this;

        return this.value;
      }

      protected async slow() {
        signal = this.then.signal;
        this.then.on({
          reset: () => void order.push('reset'),
          abort: () => void order.push('abort'),
          close: () => void order.push('close')
        });
        await work;
        this.value = 1;
        this.later();
      }

      protected async stop() {
        this.then.end();
      }

      protected async later() {
        order.push('later');
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.then.active).toBe('slow'));
    expect(signal.aborted).toBe(false);
    work.resolve();

    expect(await result).toBe(1);
    expect(order).toEqual(['close']);
    expect(test.then.status).toBe('idle');
    expect(ids(test)).toEqual(['run#1', 'stop#1', 'slow#1', 'end#1']);
  });

  it('will resolve an answer and drop what follows when ended from outside', async () => {
    const after = vi.fn();

    class Test extends Steps {
      async run() {
        this.then(this.reply);
        this.later();
      }

      async reply() {
        this.then.end();
      }

      protected async later() {
        after();
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.reply).toBeDefined());
    await test.reply();
    await result;
    expect(after).not.toHaveBeenCalled();
  });
});

describe('runs', () => {
  it('will repeat with a record each and fields kept', async () => {
    class Test extends Journal {
      count = 0;

      async run(by: number) {
        this.count += by;

        return this.count;
      }
    }

    const test = Test.new();

    expect(await test.run(1)).toBe(1);
    expect(await test.run(2)).toBe(3);
    expect(test.then.runs).toBe(2);
    expect(test.then.status).toBe('idle');
    expect(record(test)).toEqual([
      { id: 'run#1', key: 'run', args: [2], wrote: ['count'], next: [] }
    ]);
  });

  it('will queue run while a run is active', async () => {
    const work = mockPromise();
    const queues: unknown[][][] = [];

    class Test extends Steps {
      seen: string[] = [];

      async run(label: string) {
        this.see(label);

        await this;

        return this.seen;
      }

      protected async see(label: string) {
        await work;
        this.seen = this.seen.concat(label);
      }
    }

    const test = Test.new();

    test.get((self) => void queues.push(self.then.queue.slice()));

    const first = test.run('a');
    const second = test.run('b');
    const third = test.run('c');

    expect(test.then.queue).toEqual([['b'], ['c']]);

    work.resolve();

    expect(await first).toEqual(['a']);
    expect(await second).toEqual(['a', 'b']);
    expect(await third).toEqual(['a', 'b', 'c']);
    expect(test.then.queue).toEqual([]);
    expect(queues).toEqual([[], [['b'], ['c']], [['c']], []]);
  });

  it('will await the instance through the queue', async () => {
    const work = mockPromise();

    class Test extends Steps {
      async run(value?: string) {
        this.load();

        await this;

        return value;
      }

      protected async load() {
        await work;
      }
    }

    const test = Test.new();

    test.run('a');
    test.run('b');

    const awaited = test.then((value) => value);

    test.run('c');
    work.resolve();

    expect(await awaited).toBe('c');
    expect(test.then.runs).toBe(3);
  });

  it('will start a run when awaited idle', async () => {
    const called = vi.fn();

    class Test extends Steps {
      async run(value = 'x') {
        called(value);

        return value;
      }
    }

    const test = Test.new();

    expect(await test).toBe('x');
    expect(await test.run('y')).toBe('y');
    expect(await test).toBe('x');
    expect(called.mock.calls).toEqual([['x'], ['y'], ['x']]);
    expect(test.then.runs).toBe(3);
  });

  it('will reject an idle await when run takes arguments', async () => {
    class Test extends Steps {
      async run(prompt: string) {
        return prompt;
      }
    }

    const test = Test.new();

    await expect(test.then((value) => value)).rejects.toThrow(
      `${test} is idle. run() takes arguments; call it to start a run.`
    );
    expect(test.then.runs).toBe(0);
    expect(await test.run('x')).toBe('x');
  });

  it('will join a run when run takes arguments', async () => {
    class Test extends Steps {
      async run(prompt: string) {
        return prompt;
      }
    }

    const test = Test.new();

    test.run('x');

    expect(await test).toBe('x');
  });

  it('will start on idle await when run has defaults', async () => {
    class Test extends Steps {
      async run(x = 1) {
        return x;
      }
    }

    expect(await Test.new()).toBe(1);
  });

  it('will not start on idle await when run has an optional parameter', async () => {
    class Test extends Steps {
      async run(x?: number) {
        return x;
      }
    }

    const test = Test.new();

    await expect(test).rejects.toThrow(`${test} is idle. run() takes arguments; call it to start a run.`);
  });

  it('will reject the instance when the last run failed', async () => {
    class Test extends Steps {
      async run(fail?: boolean) {
        if (fail) throw new Error('boom');

        return 'ok';
      }
    }

    const test = Test.new();

    test.run(true);

    const awaited = test.then((value) => value);

    test.run(false);
    expect(await awaited).toBe('ok');

    test.run(true);
    await expect(test).rejects.toThrow('boom');
    expect(test.then.status).toBe('failed');
    expect(test.then.runs).toBe(3);
  });

  it('will reset error and status on the next run', async () => {
    class Test extends Steps {
      async run(fail: boolean) {
        if (fail) throw new Error('boom');
      }
    }

    const test = Test.new();

    await expect(test.run(true)).rejects.toThrow('boom');
    expect(test.then.error).toEqual(new Error('boom'));

    await test.run(false);
    expect(test.then.error).toBeUndefined();
    expect(test.then.status).toBe('idle');
  });

  it('will be observed through the instance', async () => {
    const seen: string[] = [];

    class Test extends Steps {
      async run() {
        this.first();
      }

      async first() {
        await flushMicrotasks();
      }
    }

    const test = Test.new();

    test.get((self) => void seen.push(`${self.then.status}:${self.then.active}`));
    await test.run();
    await flushMicrotasks();

    expect(seen).toEqual([
      'idle:undefined',
      'running:run',
      'running:undefined',
      'running:first',
      'running:undefined',
      'idle:undefined'
    ]);
  });

  it('will not expose a step outside unless a wait accepts it', () => {
    class Test extends Steps {
      second() {}
    }

    const test = Test.new();

    expect(test.second).toBeUndefined();
    expect(Object.keys(test)).not.toContain('second');
  });

  it('will reject a run on a class without run', async () => {
    class Test extends Steps {}

    await expect(Test.new().then).rejects.toThrow(/declares no run - add async run\(\) to start a run\./);
  });

  it('will mark a run awaited through catch or finally', async () => {
    const caught = mockUncaught();

    class Test extends Steps {
      async run() {
        throw new Error('boom');
      }
    }

    const handled = vi.fn();

    await Test.new().run().catch(handled);
    await Test.new().run().finally(() => {}).catch(() => {});
    await flushMicrotasks();
    expect(handled).toHaveBeenCalled();
    expect(caught).toEqual([]);
  });

  it('will throw uncaught when nobody awaits a failed run', async () => {
    const caught = mockUncaught();

    class Test extends Steps {
      protected new() {
        this.run();
      }

      async run() {
        throw new Error('nobody listening');
      }
    }

    Test.new();
    await flushMicrotasks();

    expect(caught).toEqual([new Error('nobody listening')]);
  });

  it('will not throw uncaught when awaited before the rethrow', async () => {
    const caught = mockUncaught();

    class Test extends Steps {
      async run() {
        throw new Error('late listener');
      }
    }

    const result = Test.new().run();

    await Promise.resolve();
    await expect(result).rejects.toThrow('late listener');
    await flushMicrotasks();

    expect(caught).toEqual([]);
  });

  it('will not throw uncaught when run() is awaited', async () => {
    const caught = mockUncaught();
    let error: unknown;

    class Test extends Steps {
      async run() {
        throw new Error('awaited');
      }
    }

    try {
      await Test.new().run();
    } catch (e) {
      error = e;
    }

    await flushMicrotasks();

    expect(error).toEqual(new Error('awaited'));
    expect(caught).toEqual([]);
  });

  it('will not throw uncaught when stopped', async () => {
    const caught = mockUncaught();

    class Test extends Steps {
      async run() {
        this.then.stop();
      }
    }

    Test.new().run();
    await flushMicrotasks();

    expect(caught).toEqual([]);
  });
});

describe('then', () => {
  it('will await the instance', async () => {
    class Test extends Steps {
      protected new() {
        this.run();
      }

      async run() {
        this.first();

        await this;

        return 'x';
      }

      first() {}
    }

    const test = Test.new();

    expect(await test).toBe('x');
    expect(await Promise.resolve(test)).toBe('x');
    expect(test.then.status).toBe('idle');
  });

  it('will type the result from run through the instance', async () => {
    class Test extends Steps {
      protected new() {
        this.run();
      }

      async run() {
        return { n: 1 };
      }
    }

    const result: { n: number } = await Test.new();
    const awaited: Awaited<Test> = result;

    expect(awaited).toEqual({ n: 1 });
  });

  it('will settle a set factory with the run result', async () => {
    class Flow extends Steps {
      async run() {
        return 'done';
      }
    }

    class Owner extends Model {
      result = set(() => Flow.new());
    }

    const owner = Owner.new();

    expectTypeOf<Owner['result']>().toEqualTypeOf<string>();

    try {
      void owner.result;
    } catch (suspense) {
      await suspense;
    }

    expect(owner.result).toBe('done');
  });

  it('will observe then as a callable view', async () => {
    const seen: string[] = [];
    let view: unknown;

    class Test extends Steps {
      async run() {
        this.pause();

        await this;

        return 'done';
      }

      protected async pause() {
        await flushMicrotasks();
      }
    }

    const test = Test.new();

    test.get((self) => {
      view = self.then;
      seen.push(self.then.status);
    });

    expect(typeof view).toBe('function');
    expect(view).not.toBe(test.then);

    await test.run();
    await flushMicrotasks();

    expect(seen).toEqual(['idle', 'running', 'idle']);
    await expect(Promise.resolve({ then: view })).resolves.toBe('done');
  });

  it('will resolve a set factory to the result', async () => {
    class Test extends Steps {
      protected new() {
        this.run();
      }

      async run() {
        return 'x';
      }
    }

    class Other extends Model {
      value = set(async () => Test.new());
    }

    const other = Other.new();

    expect(() => other.value).toThrow(expect.any(Promise));

    await flushMicrotasks();

    expect(other.value).toBe('x');
  });

  it('will not export then', async () => {
    class Test extends Steps {
      count = 1;

      async run() {}
    }

    const test = Test.new();

    expect(Object.keys(test)).not.toContain('then');
    expect(test.get()).toEqual({ count: 1 });
    expect(await test.run()).toBeUndefined();
  });

  it('will spread to a snapshot', async () => {
    class Test extends Steps {
      async run() {
        this.a();
      }

      a() {}
    }

    const [test] = await ran(Test);

    const snapshot = { ...test.then };

    expect(snapshot).toEqual({
      status: 'idle',
      active: undefined,
      queue: [],
      waiting: [],
      runs: 1,
      error: undefined
    });
    expect(test.then.get()).toEqual(snapshot);
    expect(test.then).not.toHaveProperty('record');
    expect(Symbol.iterator in test.then).toBe(false);
  });
});

describe('stop', () => {
  it('will discard pending and let a step in flight commit', async () => {
    const work = mockPromise();
    const later = vi.fn();

    class Test extends Journal {
      value = 0;

      async run() {
        this.load();
      }

      protected async load() {
        await work;
        this.value = 1;
        this.later();
      }

      later() {
        later();
      }
    }

    const [test, result] = await start(Test);

    test.then.stop();
    expect(test.then.status).toBe('stopped');

    work.resolve();
    await expect(result).rejects.toMatchObject({ name: 'Stopped' });
    expect(later).not.toHaveBeenCalled();
    expect(test.value).toBe(1);
    expect(ids(test)).toEqual(['run#1', 'load#1']);
    expect(test.then.status).toBe('stopped');
    expect(test.then.runs).toBe(1);
  });

  it('will reject queued runs', async () => {
    const work = mockPromise();

    class Test extends Steps {
      async run() {
        await work;
      }
    }

    const test = Test.new();
    const first = test.run();
    const second = test.run();

    test.then.stop();
    expect(test.then.queue).toEqual([]);
    await expect(second).rejects.toMatchObject({ name: 'Stopped' });

    work.resolve();
    await expect(first).rejects.toMatchObject({ name: 'Stopped' });
    expect(test.then.runs).toBe(1);
  });

  it('will unwind on abort', async () => {
    const work = mockPromise();
    const undo = vi.fn();

    class Test extends Journal {
      value = 0;

      async run() {
        this.first();
      }

      protected first() {
        this.value = 1;
        this.then.on({ reset: undo });
        this.second();
      }

      async second() {
        await work;
      }
    }

    const [test, result] = await start(Test);

    test.then.abort();
    expect(test.then.status).toBe('aborted');
    work.resolve();

    await expect(result).rejects.toMatchObject({ name: 'Aborted', message: `${test} was aborted.` });
    expect(undo).toHaveBeenCalledWith();
    expect(test.value).toBe(0);
    expect(test.then.status).toBe('aborted');
    expect(record(test).map((entry) => entry.unwound)).toEqual([undefined, true, undefined]);
  });

  it('will keep what was done on stop', async () => {
    const work = mockPromise();
    const undo = vi.fn();

    class Test extends Steps {
      value = 0;

      async run() {
        this.first();
      }

      protected first() {
        this.value = 1;
        this.then.on({ reset: undo });
        this.second();
      }

      async second() {
        await work;
      }
    }

    const [test, result] = await start(Test);

    test.then.stop();
    work.resolve();

    await expect(result).rejects.toMatchObject({ name: 'Stopped' });
    expect(undo).not.toHaveBeenCalled();
    expect(test.value).toBe(1);
  });

  it('will fail an abort whose undo throws, given the abort as cause', async () => {
    const work = mockPromise();

    class Test extends Steps {
      async run() {
        this.first();
      }

      protected first() {
        this.then.on({
          reset: () => {
            throw new Error('stuck');
          }
        });
        this.second();
      }

      async second() {
        await work;
      }
    }

    const [test, result] = await start(Test);

    test.then.abort('cancelled');
    work.resolve();

    const error = await result.catch((error) => error);

    expect(error.message).toBe('stuck');
    expect(error.cause).toMatchObject({ name: 'Aborted', message: 'cancelled', cause: 'cancelled' });
    expect(test.then.status).toBe('failed');
    expect(test.then.error).toBe(error);
  });

  it('will not overwrite a cause, or set one on a value, when an aborted undo throws', async () => {
    const thrown: unknown[] = [new Error('stuck', { cause: 'own' }), 'stuck'];

    class Test extends Steps {
      async run() {
        this.first();
      }

      protected first() {
        const error = thrown.shift();

        this.then.on({
          reset: () => {
            throw error;
          }
        });
        this.second();
      }

      async second() {
        const { signal } = this.then;

        await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
      }
    }

    for (const expected of [{ message: 'stuck', cause: 'own' }, 'stuck']) {
      const [test, result] = await start(Test);

      test.then.abort();

      expect(await result.catch((error) => error)).toEqual(typeof expected == 'string' ? expected : expect.objectContaining(expected));
      expect(test.then.status).toBe('failed');
    }
  });

  it('will stop from inside a step', async () => {
    const later = vi.fn();

    class Test extends Journal {
      async run() {
        this.then.stop();
        this.later();
      }

      later() {
        later();
      }
    }

    const test = Test.new();

    await expect(test.run()).rejects.toMatchObject({ name: 'Stopped' });
    expect(later).not.toHaveBeenCalled();
    expect(record(test)[0].next).toEqual([{ id: 'later#1', key: 'later', args: [] }]);
  });

  it('will stop when the instance is destroyed', async () => {
    const work = mockPromise();

    class Test extends Steps {
      async run() {
        await work;
      }
    }

    const test = Test.new();
    const result = test.run();

    test.set(null);
    work.resolve();

    await expect(result).rejects.toMatchObject({ name: 'Stopped' });
    expect(test.then.status).toBe('stopped');
  });

  it('will not stop when idle', () => {
    class Test extends Steps {
    }

    const test = Test.new();

    test.then.stop();
    expect(test.then.status).toBe('idle');
  });

  it('will reject the run when run does not catch a stop', async () => {
    const work = mockPromise();
    const after = vi.fn();

    class Test extends Steps {
      async run() {
        this.load();

        await this;

        after();
        return 'done';
      }

      protected async load() {
        await work;
      }
    }

    const [test, result] = await start(Test);

    test.then.stop();
    work.resolve();

    await expect(result).rejects.toMatchObject({ name: 'Stopped' });
    expect(after).not.toHaveBeenCalled();
  });

  it('will resolve with what run returns when it catches a stop', async () => {
    const caught = mockUncaught();

    class Test extends Steps {
      async run() {
        this.then(this.reply);

        try {
          await this;
        } catch (error) {
          return (error as Error).name;
        }
      }

      async reply() {}
    }

    const [test, result] = await start(Test);

    test.then.stop();

    expect(await result).toBe('Stopped');
    expect(test.then.status).toBe('stopped');
    await flushMicrotasks();
    expect(caught).toEqual([]);
  });

  it('will run again after a stop', async () => {
    class Test extends Steps {
      async run() {
        this.then.stop();
      }
    }

    const test = Test.new();

    await expect(test.run()).rejects.toMatchObject({ name: 'Stopped' });
    await expect(test.run()).rejects.toMatchObject({ name: 'Stopped' });
    expect(test.then.runs).toBe(2);
  });

  it('will carry a reason to the run and queue', async () => {
    const work = mockPromise();
    const undo = vi.fn();

    class Test extends Steps {
      async run() {
        this.hold();
      }

      protected hold() {
        this.then.on({ reset: undo });
        this.pause();
      }

      protected async pause() {
        await work;
      }
    }

    const test = Test.new();
    const first = test.run();
    const second = test.run();

    await flushMicrotasks();
    test.then.abort('cancelled by user');
    work.resolve();

    const stopped = { name: 'Aborted', message: 'cancelled by user', cause: 'cancelled by user' };

    await expect(second).rejects.toMatchObject(stopped);
    await expect(first).rejects.toMatchObject(stopped);
    await expect(first).rejects.toBe(await second.catch((error) => error));
    expect(undo).toHaveBeenCalledWith();
    expect(test.then.error).toBeUndefined();
  });

  it('will carry a reason on stop', async () => {
    const work = mockPromise();
    const reason = { code: 499 };

    class Test extends Steps {
      async run() {
        await work;
      }
    }

    const test = Test.new();
    const result = test.run();

    test.then.stop(reason);
    work.resolve();

    const error = await result.catch((error) => error);

    expect(error).toMatchObject({ name: 'Stopped', message: `${test} was stopped.` });
    expect(error.cause).toBe(reason);
  });

  it('will not set a cause without a reason', async () => {
    const work = mockPromise();

    class Test extends Steps {
      async run() {
        await work;
      }
    }

    const test = Test.new();
    const result = test.run();

    test.then.stop();
    work.resolve();

    const error = await result.catch((error) => error);

    expect(error.message).toBe(`${test} was stopped.`);
    expect('cause' in error).toBe(false);
  });

  it('will keep the failure when stopped during its unwind, rejecting the queue', async () => {
    const undone = mockPromise();

    class Test extends Steps {
      async run() {
        this.first();
      }

      protected async first() {
        this.then.on({ reset: () => undone });
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    const test = Test.new();
    const result = test.run();
    const queued = test.run();

    await vi.waitFor(() => expect(test.then.status).toBe('failed'));
    test.then.stop('later');
    undone.resolve();

    await expect(result).rejects.toThrow('boom');
    await expect(queued).rejects.toMatchObject({ name: 'Stopped', cause: 'later' });
    expect(test.then.status).toBe('failed');
    expect(test.then.error).toEqual(new Error('boom'));
  });
});

describe('hooks', () => {
  it('will call hooks around each step', async () => {
    const order: unknown[][] = [];
    const wrote: string[][] = [];

    class Test extends Steps {
      value = 0;

      async run() {
        this.ship('a', 1);
      }

      protected async ship(id: string, n: number) {
        order.push(['ship', id, n]);
      }

      protected before(key: string, args: unknown[]) {
        this.value++;
        order.push(['before', key, args]);
      }

      protected after(key: string, entry: Steps.Entry) {
        order.push(['after', key, entry.id]);
        wrote.push(entry.wrote);
      }
    }

    const [test] = await ran(Test);

    expect(order).toEqual([
      ['before', 'run', []],
      ['after', 'run', 'run#1'],
      ['before', 'ship', ['a', 1]],
      ['ship', 'a', 1],
      ['after', 'ship', 'ship#1']
    ]);
    expect(test.value).toBe(2);
    expect(wrote).toEqual([[], []]);
  });

  it('will not wrap hooks as steps', async () => {
    const before = vi.fn();

    class Test extends Steps {
      async run() {}

      before(step: string) {
        before(step);
      }

      beforeNext() {}
    }

    const test = Test.new();

    test.before('outside');
    expect(before).toHaveBeenCalledWith('outside');
    expect(test.beforeNext).toBeUndefined();
  });

  it('will fail when a hook throws', async () => {
    class Test extends Steps {
      async run() {}

      protected before() {
        throw new Error('hook');
      }
    }

    await fails(Test, 'hook');
  });

  it('will clean up in the tail on every outcome', async () => {
    const cleaned: string[] = [];

    class Test extends Steps {
      async run(outcome: 'done' | 'failed' | 'stopped') {
        this.work(outcome);

        try {
          await this;
        } finally {
          cleaned.push(outcome);
        }

        return outcome;
      }

      protected async work(outcome: string) {
        if (outcome == 'failed') throw new Error('boom');
        if (outcome == 'stopped') this.then.stop();
      }
    }

    const test = Test.new();

    expect(await test.run('done')).toBe('done');
    await expect(test.run('failed')).rejects.toThrow('boom');
    await expect(test.run('stopped')).rejects.toMatchObject({ name: 'Stopped' });
    expect(cleaned).toEqual(['done', 'failed', 'stopped']);
  });

  it('will compensate before the tail when a run fails', async () => {
    const order: string[] = [];

    class Test extends Steps {
      async run() {
        this.hold();

        try {
          await this;
        } catch (error) {
          order.push(`tail: ${(error as Error).message}`);
          throw error;
        }
      }

      protected async hold() {
        this.then.on({ reset: () => void order.push('undo') });
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }
    }

    await fails(Test, 'boom');
    expect(order).toEqual(['undo', 'tail: boom']);
  });

  it('will not stop a run while its tail is pending', async () => {
    const work = mockPromise();

    class Test extends Steps {
      async run() {
        await this;
        await work;

        return 'kept';
      }
    }

    const [test, result] = await start(Test);

    test.then.stop();
    work.resolve();

    expect(await result).toBe('kept');
    expect(test.then.status).toBe('idle');
  });

  it('will call an overridden hook once', async () => {
    const order: string[] = [];

    class Parent extends Steps {
      async run() {}

      protected after() {
        order.push('parent');
      }
    }

    class Child extends Parent {
      protected after() {
        order.push('child');
      }
    }

    await Child.new().run();
    expect(order).toEqual(['child']);
  });

  it('will journal and hand to after the step whose failure ends the run', async () => {
    class Test extends Journal {
      async run() {
        this.a();
      }

      protected async a() {
        throw new Error('boom');
      }
    }

    const [test] = await fails(Test, 'boom');

    expect(record(test).at(-1)).toMatchObject({ id: 'a#1', error: new Error('boom') });
  });
});

describe('Aborted and Stopped', () => {
  it('will reject runs and abort signals with instances of each, abort handlers with nothing', async () => {
    const reasons: unknown[] = [];
    const signals: unknown[] = [];

    class Test extends Steps {
      async run() {
        this.a();
      }

      protected async a() {
        this.then.on({ abort: (...args) => void reasons.push(args) });
        this.slow();
      }

      protected async slow() {
        const { signal } = this.then;

        await new Promise((_, reject) =>
          signal.addEventListener('abort', () => {
            signals.push(signal.reason);
            reject(signal.reason);
          })
        );
      }
    }

    const errors: unknown[] = [];

    for (const halt of ['abort', 'stop'] as const) {
      const test = Test.new();
      const result = test.run();

      await vi.waitFor(() => expect(test.then.active).toBe('slow'));
      test.then[halt]();
      errors.push(await result.catch((error) => error));
    }

    expect(errors[0]).toBeInstanceOf(Steps.Aborted);
    expect(errors[1]).toBeInstanceOf(Steps.Stopped);
    expect(errors).toMatchObject([{ name: 'Aborted' }, { name: 'Stopped' }]);
    expect(reasons).toEqual([[], []]);
    expect(signals).toEqual(errors);
  });

  it('will run a step method given for abort with the error, close and reset with none, recorded', async () => {
    const seen: unknown[] = [];
    const reset = vi.fn();
    const close = vi.fn();

    class Test extends Journal {
      async run(mode: string) {
        this.a(mode);
      }

      protected async a(mode: string) {
        this.then.on({ abort: this.aborted, close: this.closed, reset: this.unwind });

        if (mode == 'halt') this.slow();
        if (mode == 'fail') this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }

      protected async slow() {
        const { signal } = this.then;

        await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
      }

      protected async aborted(...args: unknown[]) {
        seen.push(args);
      }

      protected async closed(...args: unknown[]) {
        close(...args);
      }

      protected async unwind(...args: unknown[]) {
        reset(...args);
      }
    }

    await Test.new().run('clean');

    const failed = Test.new();

    await failed.run('fail').catch(() => {});

    const test = Test.new();
    const result = test.run('halt');

    await vi.waitFor(() => expect(test.then.active).toBe('slow'));
    test.then.abort();
    await result.catch(() => {});

    expect(seen).toEqual([[new Error('boom')], []]);
    expect(reset.mock.calls).toEqual([[], []]);
    expect(close.mock.calls).toEqual([[], [], []]);
    expect(record(failed).find((entry) => entry.key == 'aborted')).toMatchObject({ args: [{ name: 'Error', message: 'boom' }] });
    expect(record(test).find((entry) => entry.key == 'aborted')).toMatchObject({ args: [] });
  });
});

describe('Steps', () => {
  it('will run and type the result from run', async () => {
    class Test extends Journal {
      value = 0;

      async run(n: number) {
        this.value = n;

        await this;

        return { n: this.value };
      }
    }

    const test = Test.new();
    const result = await test.run(2);

    expectTypeOf(test.then).toEqualTypeOf<Steps.Runner<Test>>();
    expectTypeOf(test.then.status).toEqualTypeOf<Steps.Status>();
    expectTypeOf<Awaited<Test>>().toEqualTypeOf<{ n: number }>();
    expect(result).toEqual({ n: 2 });
    expect(test.then.self).toBe(test);
    expect(record(test).map((entry) => entry.key)).toEqual(['run']);
  });

  it('will type the result as void when run returns nothing', async () => {
    class Test extends Steps {
      value = 1;

      async run() {}
    }

    const result = await Test.new();

    expectTypeOf(result).toEqualTypeOf<void>();
    expect(result).toBeUndefined();
  });

  it('will allow run to narrow its parameters', async () => {
    class Test extends Steps {
      prompt = '';

      async run(prompt: string) {
        this.prompt = prompt;
      }
    }

    const test = Test.new();

    expectTypeOf(test.run).parameters.toEqualTypeOf<[prompt: string]>();
    await test.run('hi');
    expect(test.prompt).toBe('hi');
  });

  it('will collect steps through intermediate classes', async () => {
    class B extends Journal {
      async run() {
        this.first();
      }

      protected async first() {
        this.second();
      }

      protected async second() {}
    }

    class C extends B {
      protected async second() {
        this.third();
      }

      protected async third() {}
    }

    const [test] = await ran(C);

    expect(record(test).map((entry) => entry.key)).toEqual(['run', 'first', 'second', 'third']);
  });

  it('will not define hooks on the prototype', () => {
    const own = Object.getOwnPropertyNames(Steps.prototype);

    expect(own).toEqual(['constructor']);
  });

  it('will call hooks declared by override', async () => {
    const order: unknown[] = [];

    class Test extends Steps {
      async run() {
        this.fail();
      }

      protected async fail() {
        throw new Error('boom');
      }

      protected override before(step: string) {
        order.push(['before', step]);
      }

      protected override after(step: string, entry: Steps.Entry) {
        order.push(['after', step, entry.id]);
      }
    }

    await fails(Test, 'boom');
    expect(order).toEqual([
      ['before', 'run'],
      ['after', 'run', 'run#1'],
      ['before', 'fail'],
      ['after', 'fail', 'fail#1']
    ]);
  });

  it('will throw if end is given a value', async () => {
    class Test extends Steps {
      async run() {
        // @ts-expect-error - end takes no value
        this.then.end('x');
      }
    }

    const [test] = await fails(Test, 'end() takes no value; the result is what run returns.');

    // @ts-expect-error - end takes no value
    expect(() => test.then.end('x')).toThrow('end() takes no value; the result is what run returns.');
  });

  it('will require run to be async', () => {
    class Test extends Steps {
      // @ts-expect-error - run returns a Promise
      run() {
        return 1;
      }
    }

    void Test;
  });

  it('will check hooks by declaration', () => {
    class Test extends Steps {
      async run() {}

      // @ts-expect-error
      protected override before(step: number) {
        void step;
      }

      // @ts-expect-error
      protected override after(step: string, entry: Steps.Entry, more: number) {
        void step, entry, more;
      }

      // @ts-expect-error
      protected override bakc() {}
    }

    expect(Test.new().then.status).toBe('idle');
  });
});

describe('hot update', () => {
  let count = 0;

  const hot = <T>(Test: T) => {
    const id = `steps-hot-${count++}`;

    accept(id, { Test });

    return <N>(Next: N) => accept(id, { Test: Next }).Test;
  };

  function body(seen: string[], tag: string) {
    class Test extends Journal {
      async run() {
        this.a();
      }

      protected async a() {
        seen.push(tag);
      }
    }

    return Test;
  }

  function added(seen: string[], tag: string, pause?: Promise<unknown>) {
    class Test extends Steps {
      async run() {
        this.a();
        this.b();
      }

      protected async a() {
        await pause;
        seen.push('a');
      }

      protected async b() {
        seen.push('b');
      }

      protected after(step: string) {
        seen.push(`${tag} ${step}`);
      }
    }

    return Test;
  }

  function removed(seen: string[], tag: string, pause?: Promise<unknown>) {
    class Test extends Steps {
      async run() {
        this.a();
      }

      protected async a() {
        await pause;
        seen.push('a');
      }

      protected after(step: string) {
        seen.push(`${tag} ${step}`);
      }
    }

    return Test as unknown as ReturnType<typeof added>;
  }

  function waiting(seen: string[], tag: string) {
    class Test extends Steps {
      async run() {
        this.then(this.reply);
      }

      async reply() {
        seen.push(tag);
      }
    }

    return Test;
  }

  it('will keep an open wait answerable across a patch', async () => {
    const seen: string[] = [];
    const Test = waiting(seen, 'old');
    const patch = hot(Test);
    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.reply).toBeDefined());
    expect(patch(waiting(seen, 'new'))).toBe(Test);

    await flushMicrotasks();
    expect(test.reply).toBeDefined();

    await test.reply();
    await result;
    expect(seen).toEqual(['new']);
  });

  it('will run a patched step body on a live instance', async () => {
    const seen: string[] = [];
    const Test = body(seen, 'a1');
    const patch = hot(Test);
    const [test] = await ran(Test);

    expect(patch(body(seen, 'a2'))).toBe(Test);

    await flushMicrotasks();
    await test.run();
    expect(seen).toEqual(['a1', 'a2']);
    expect(ids(test)).toEqual(['run#1', 'a#1']);
  });

  it('will wire a step added by a patch, and a patched run and hook', async () => {
    const seen: string[] = [];
    const Test = removed(seen, 'after');
    const patch = hot(Test);
    const [test] = await ran(Test);

    expect(patch(added(seen, 'after2'))).toBe(Test);

    await flushMicrotasks();
    await test.run();
    expect(seen).toEqual(['after run', 'a', 'after a', 'after2 run', 'a', 'after2 a', 'b', 'after2 b']);
  });

  it('will stop treating a removed step as one, failing a pending call to it', async () => {
    const seen: string[] = [];
    const work = mockPromise();
    const Test = added(seen, 'after', work);
    const patch = hot(Test);
    const [, result] = await start(Test);

    expect(patch(removed(seen, 'after', work))).toBe(Test);

    await flushMicrotasks();
    work.resolve();

    await expect(result).rejects.toThrow('b was removed by a hot update.');
    expect(seen).toEqual(['after run', 'a', 'after a', 'after b']);
  });
});

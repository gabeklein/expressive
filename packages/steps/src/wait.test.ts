import { Model } from '@expressive/mvc';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { fails, flushMicrotasks, ids, Journal, mockPromise, ran, record, start } from '../test.setup';

import { Steps } from './steps';

describe('wait', () => {
  it('will park until a listed step answers', async () => {
    class Test extends Journal {
      answer = '';

      async run() {
        this.ask('question');
        this.later();
      }

      ask(question: string) {
        this.then(this.reply, this.skip);
      }

      reply(answer: string) {
        this.answer = answer;
        this.thanks();
      }

      skip() {}
      thanks() {}
      later() {}
    }

    const [test, result] = await start(Test);

    expect(test.then.status).toBe('waiting');
    expect(test.then.waiting).toEqual([{ id: 'wait#1', step: 'ask', args: ['question'], answers: ['reply', 'skip'] }]);

    test.reply('yes');
    expect(test.then.waiting).toEqual([]);
    expect(test.then.status).toBe('running');

    await result;
    expect(test.answer).toBe('yes');
    expect(ids(test)).toEqual(['run#1', 'ask#1', 'reply#1', 'thanks#1', 'later#1']);
    expect(record(test)[1].next).toEqual([{ id: 'wait#1', key: 'wait', args: [], answers: ['reply', 'skip'] }]);
    expect(record(test)[2]).toMatchObject({ wake: 'wait#1', wrote: ['answer'] });
  });

  it('will run what follows a wait after its answer', async () => {
    const order: string[] = [];

    class Test extends Steps {
      async run() {
        this.then(this.reply);
        this.log('after');
      }

      reply() {
        this.log('reply');
        this.log('reply again');
      }

      log(message: string) {
        order.push(message);
      }
    }

    const [test, result] = await start(Test);

    expect(order).toEqual([]);

    test.reply();
    await result;

    expect(order).toEqual(['reply', 'reply again', 'after']);
  });

  it('will answer the oldest wait first', async () => {
    class Test extends Journal {
      answers: string[] = [];

      async run() {
        this.then(['a', 'b'], this.ask);
      }

      ask(name: string) {
        this.then(this.reply);
      }

      reply(answer: string) {
        this.answers = this.answers.concat(answer);
      }
    }

    const test = Test.new();
    const seen: unknown[] = [];
    const result = test.run();

    test.get((self) => void seen.push(self.then.waiting.map((wait) => wait.args[0])));

    await flushMicrotasks();
    test.reply('1');
    await flushMicrotasks();
    test.reply('2');

    await result;
    expect(test.answers).toEqual(['1', '2']);
    expect(record(test).filter((entry) => entry.wake).map((entry) => [entry.wake, entry.args])).toEqual([
      ['wait#1', ['1']],
      ['wait#2', ['2']]
    ]);
    expect(seen).toEqual([[], ['a'], ['a', 'b'], ['b'], []]);
  });

  it('will expose a step only while a wait accepts it', async () => {
    class Test extends Steps {
      async run() {
        this.then(this.reply);
      }

      reply() {}
    }

    const test = Test.new();
    const seen: boolean[] = [];

    test.get((self) => void seen.push(typeof self.reply == 'function'));

    expect(test.reply).toBeUndefined();

    const result = test.run();

    await flushMicrotasks();
    expect(test.reply).toBeTypeOf('function');
    expect(Object.keys(test)).not.toContain('reply');

    test.reply();
    expect(test.reply).toBeUndefined();

    await result;
    await flushMicrotasks();
    expect(seen).toEqual([false, true, false]);
  });

  it('will schedule a waited-for step from inside a step', async () => {
    class Test extends Steps {
      count = 0;

      async run() {
        this.reply();
      }

      reply() {
        this.count++;
      }
    }

    const [test] = await ran(Test);

    expect(test.count).toBe(1);
  });

  it('will answer the wait opened with the same first argument', async () => {
    class Test extends Journal {
      answers: string[] = [];

      async run() {
        this.then(['a', 'b'], this.ask);
      }

      ask(name: string) {
        this.then(this.reply);
      }

      reply(name: string) {
        this.answers = this.answers.concat(name);
      }
    }

    const [test, result] = await start(Test);

    test.reply('b');

    expect(test.then.waiting.map((wait) => wait.args[0])).toEqual(['a']);

    test.reply('a');
    await result;

    expect(record(test).filter((entry) => entry.wake).map((entry) => [entry.wake, entry.args])).toEqual([
      ['wait#2', ['b']],
      ['wait#1', ['a']]
    ]);
  });

  it('will resolve an answer once its own branch is done', async () => {
    const work = mockPromise();
    const order: string[] = [];

    class Test extends Steps {
      async run() {
        this.then(this.reply);
        this.later();
      }

      async reply() {
        this.follow();
      }

      async follow() {
        await work;
        order.push('follow');
      }

      async later() {
        await work;
        order.push('later');
      }
    }

    const [test, result] = await start(Test);

    const answered = test.reply().then(() => order.push('answered'));

    await flushMicrotasks();
    expect(order).toEqual([]);

    work.resolve();
    await answered;
    expect(order).toEqual(['follow', 'answered']);

    await result;
    expect(order).toEqual(['follow', 'answered', 'later']);
  });

  it('will reject an answer if the run stops first', async () => {
    const work = mockPromise();

    class Test extends Steps {
      async run() {
        this.then(this.reply);
      }

      async reply() {
        this.follow();
      }

      async follow() {
        await work;
      }
    }

    const [test, result] = await start(Test);

    const answered = test.reply();

    await flushMicrotasks();
    test.then.stop();
    work.resolve();

    await expect(answered).rejects.toMatchObject({ name: 'Stopped' });
    await expect(result).rejects.toMatchObject({ name: 'Stopped' });
  });

  it('will reject an answer if its step fails', async () => {
    class Test extends Steps {
      async run() {
        this.then(this.reply);
      }

      async reply() {
        throw new Error('boom');
      }
    }

    const [test, result] = await start(Test);

    await expect(test.reply()).rejects.toThrow('boom');
    await expect(result).rejects.toThrow('boom');
  });

  it('will not answer a wait with a step it does not list', async () => {
    class Test extends Steps {
      async run() {
        this.then(this.reply);
      }

      reply() {}
      other() {}
    }

    const [test, result] = await start(Test);

    expect(test.other).toBeUndefined();

    test.reply();
    await result;
  });

  it('will fail if run answers a wait', async () => {
    class Test extends Steps {
      async run() {
        this.then(this.run);
      }
    }

    await fails(Test, 'run cannot answer a wait.');
  });

  it('will not wait on a step of another instance', async () => {
    class Test extends Steps {
      async run(other?: Test) {
        if (other) this.then(other.reply);
      }

      reply() {}
    }

    const other = Test.new();

    await expect(Test.new().run(other)).rejects.toThrow('a step cannot await its own run.');
  });

  it('will release waits on stop', async () => {
    class Test extends Steps {
      async run() {
        this.then(this.reply);
      }

      reply() {}
    }

    const [test, result] = await start(Test);

    const { reply } = test;

    test.then.stop();

    await expect(result).rejects.toMatchObject({ name: 'Stopped' });
    expect(test.then.waiting).toEqual([]);
    expect(() => reply()).toThrow('reply cannot be called from outside; call run() to start a run.');
  });

  it('will answer its own wait through a settled step', async () => {
    const calls = new Map<string, () => unknown>();

    class Test extends Journal {
      answers: string[] = [];

      async run() {
        this.then(['a', 'b'], this.ask);
      }

      ask(name: string) {
        calls.set(name, () => this.reply(name.toUpperCase()));
        this.then(this.reply);
      }

      reply(answer: string) {
        this.answers = this.answers.concat(answer);
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.then.waiting).toHaveLength(2));

    await calls.get('b')!();
    expect(test.then.waiting.map((wait) => wait.args[0])).toEqual(['a']);

    await calls.get('a')!();
    await result;

    expect(test.answers).toEqual(['B', 'A']);
    expect(record(test).filter((entry) => entry.wake).map((entry) => [entry.wake, entry.args])).toEqual([
      ['wait#2', ['B']],
      ['wait#1', ['A']]
    ]);
  });

  it('will route a settled step call as an outside call', async () => {
    let poke!: () => unknown;

    class Test extends Steps {
      answer = '';

      async run() {
        poke = () => this.reply('poked');
        this.ask();
      }

      ask() {
        this.then(this.reply);
      }

      reply(answer: string) {
        this.answer = answer;
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.then.status).toBe('waiting'));
    await poke();
    await result;

    expect(test.answer).toBe('poked');
  });

  it('will bind a settled step call to its run', async () => {
    let poke!: () => unknown;

    class Test extends Steps {
      async run() {
        poke = () => this.reply();
        this.then(this.reply);
      }

      reply() {}
    }

    const test = Test.new();
    const first = test.run();
    const stale = poke;

    await vi.waitFor(() => expect(test.then.status).toBe('waiting'));
    test.reply();
    await first;

    const second = test.run();

    await vi.waitFor(() => expect(test.then.status).toBe('waiting'));
    expect(() => stale()).toThrow('run has settled; reply cannot run.');
    expect(test.then.waiting).toHaveLength(1);

    await poke();
    await second;
  });

  it('will not journal writes through a settled step', async () => {
    let write!: () => void;

    class Test extends Journal {
      value = 0;

      async run() {
        write = () => void (this.value = 1);
        this.then(this.reply);
      }

      reply() {}
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.then.status).toBe('waiting'));
    write();
    test.reply();
    await result;

    expect(test.value).toBe(1);
    expect(record(test).map((entry) => entry.wrote)).toEqual([[], []]);
  });

  it('will not have wait on the runner', () => {
    class Test extends Steps {
    }

    const test = Test.new();

    expect('wait' in test.then).toBe(false);
  });

  it('will journal a failing answer with the wait it answered', async () => {
    class Test extends Journal {
      async run() {
        this.then(this.allow).catch();
      }

      async allow() {
        throw new Error('denied');
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.then.status).toBe('waiting'));
    await test.allow().catch(() => {});
    await result.catch(() => {});

    expect(record(test).at(-1)).toMatchObject({ key: 'allow', wake: 'wait#1', error: new Error('denied') });
  });

  it('will reject an answer whose subtree failed when the tail catches', async () => {
    class Test extends Steps {
      async run() {
        this.ask();

        try {
          await this;
        } catch {
          return 'handled';
        }
      }

      protected async ask() {
        this.then(this.reply);
      }

      async reply() {
        this.boom();
      }

      protected async boom() {
        throw new Error('boom');
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.reply).toBeDefined());

    const answered = test.reply();

    await expect(answered).rejects.toThrow('boom');
    expect(await result).toBe('handled');
  });
});

describe('races', () => {
  afterEach(() => void vi.useRealTimers());

  function delay(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);

      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(signal.reason);
      });
    });
  }

  it('will answer a wait from a racer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

    class Test extends Journal {
      answer = '';

      async run() {
        this.then(this.allow, this.deny, this.timeout());
      }

      protected async timeout() {
        this.then({ ms: 100 });
        this.deny('timeout');
      }

      allow() {
        this.answer = 'allowed';
      }

      deny(reason: string) {
        this.answer = reason;
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.advanceTimersByTimeAsync(99);
    expect(test.then.status).toBe('waiting');
    expect(test.then.waiting.map((wait) => wait.id)).toEqual(['wait#1', 'wait#2']);

    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(test.answer).toBe('timeout');
    expect(record(test).map((entry) => [entry.id, entry.wake])).toEqual([
      ['run#1', undefined],
      ['timeout#1', undefined],
      ['deny#1', 'wait#1']
    ]);
    expect(record(test)[0].next).toEqual([
      { id: 'wait#1', key: 'wait', args: [], answers: ['allow', 'deny'], race: { id: 'timeout#1', key: 'timeout', args: [] } }
    ]);
    expect(record(test)[1].next).toEqual([
      { id: 'wait#2', key: 'wait', args: [100], answers: [] },
      { id: 'deny#1', key: 'deny', args: ['timeout'] }
    ]);
  });

  it('will cancel and unwind racers once answered from outside', async () => {
    let signal!: AbortSignal;
    const lost = vi.fn();
    const later = vi.fn();
    const undo = vi.fn();

    class Test extends Steps {
      value = 0;

      async run() {
        this.then(this.reply, this.watch());
      }

      protected async watch() {
        this.value = 1;
        this.then.on({ reset: undo });
        this.poll();
      }

      protected async poll() {
        signal = this.then.signal;
        await delay(100, signal).catch(lost);
        this.later();
      }

      protected later() {
        later();
      }

      reply() {}
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(signal).toBeDefined());
    expect(signal.aborted).toBe(false);

    test.reply();
    expect(signal.aborted).toBe(true);

    await result;
    expect(lost).toHaveBeenCalled();
    expect(later).not.toHaveBeenCalled();
    expect(undo).toHaveBeenCalledWith();
    expect(test.value).toBe(0);
  });

  it('will keep what the winning racer did, unwinding the others', async () => {
    const work = mockPromise();
    const unpost = vi.fn();
    const unwarn = vi.fn();
    const posted: string[] = [];

    class Test extends Journal {
      warned = false;
      post = '';

      async run() {
        this.then(this.reply, this.publish(), this.timeout());
      }

      protected async publish() {
        this.post = 'draft';
        posted.push('draft');
        this.then.on({ reset: unpost });
        await work;
      }

      protected async timeout() {
        this.warned = true;
        this.then.on({ reset: unwarn });
        this.reply();
      }

      reply() {}
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.then.waiting).toEqual([]));
    expect(unpost).not.toHaveBeenCalled();

    // a racer mid-step settles first, then its branch unwinds
    work.resolve();
    await result;

    expect(unpost).toHaveBeenCalled();
    expect(test.post).toBe('');
    expect(posted).toEqual(['draft']);
    expect(unwarn).not.toHaveBeenCalled();
    expect(test.warned).toBe(true);
    expect(Object.fromEntries(record(test).map((entry) => [entry.id, entry.unwound]))).toEqual({
      'run#1': undefined,
      'timeout#1': undefined,
      'reply#1': undefined,
      'publish#1': true
    });
  });

  it('will drop what a racer has yet to run', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

    const later = vi.fn();

    class Test extends Steps {
      async run() {
        this.then(this.reply, this.timeout());
      }

      protected async timeout() {
        this.then({ min: 1 });
        this.later();
      }

      protected later() {
        later();
      }

      reply() {}
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.then.waiting).toHaveLength(2));

    test.reply();
    expect(test.then.waiting).toEqual([]);

    await result;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(later).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('will release a gate a racer holds once answered', async () => {
    const lock = {};
    const work = mockPromise();

    class Test extends Steps {
      async run(hold: boolean) {
        if (!hold) return this.locked();

        this.then.only(1);
        this.then(this.reply, this.watch());
      }

      protected async watch() {
        this.then.only(1, lock);
        this.slow();
      }

      protected async slow() {
        await work;
      }

      protected locked() {
        this.then.only(1, lock);
        this.done();
      }

      protected done() {}

      reply() {}
    }

    const first = Test.new();
    const second = Test.new();
    const held = first.run(true);

    await vi.waitFor(() => expect(first.then.active).toBe('slow'));

    const queued = second.run(false);

    await flushMicrotasks();
    expect(second.then.active).toBe(undefined);
    expect(second.then.status).toBe('running');

    first.reply();
    await queued;
    expect(second.then.status).toBe('idle');

    work.resolve();
    await held;
  });

  it('will leave the wait open if racers finish without answering', async () => {
    const nudge = vi.fn();

    class Test extends Steps {
      async run() {
        this.then(this.reply, this.nudge());
      }

      protected nudge() {
        nudge();
      }

      reply() {}
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(nudge).toHaveBeenCalled());
    await flushMicrotasks();
    expect(test.then.status).toBe('waiting');

    test.reply();
    await result;
  });

  it('will start racers when the plan reaches the wait', async () => {
    const work = mockPromise();
    const watch = vi.fn();

    class Test extends Steps {
      async run() {
        this.slow();
        this.ask('question');
      }

      async slow() {
        await work;
      }

      ask(question: string) {
        this.then(this.reply, this.watch(question), this.other());
      }

      protected watch(question: string) {
        watch(question);
      }

      protected other() {}

      reply() {}
    }

    const [test, result] = await start(Test);

    expect(watch).not.toHaveBeenCalled();

    work.resolve();
    await vi.waitFor(() => expect(watch).toHaveBeenCalledWith('question'));

    test.reply();
    await result;
  });

  it('will answer with the racer\'s args', async () => {
    class Test extends Steps {
      answer = '';

      async run() {
        this.ask('question');

        await this;

        return this.answer;
      }

      ask(question: string) {
        this.then(this.reply, this.guess(question));
      }

      protected guess(question: string) {
        this.reply(`re: ${question}`);
      }

      reply(answer: string) {
        this.answer = answer;
      }
    }

    expect(await Test.new().run()).toBe('re: question');
  });

  it('will answer each wait from its own racer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

    class Test extends Journal {
      async run() {
        this.then([200, 100], this.ask);
      }

      ask(ms: number) {
        this.then(this.reply, this.timeout(ms));
      }

      protected timeout(ms: number) {
        this.then({ ms });
        this.reply();
      }

      reply() {}
    }

    const test = Test.new();
    const result = test.run();

    await vi.advanceTimersByTimeAsync(200);
    await result;

    expect(record(test).filter((entry) => entry.wake).map((entry) => entry.wake)).toEqual(['wait#2', 'wait#1']);
  });

  it('will fail the run if a racer throws', async () => {
    class Test extends Steps {
      value = 0;

      async run() {
        this.value = 1;
        this.then(this.reply, this.watch());
      }

      protected async watch() {
        throw new Error('racer');
      }

      reply() {}
    }

    const [test] = await fails(Test, 'racer');

    expect(test.value).toBe(1);
    expect(test.then.waiting).toEqual([]);
    expect(test.then.status).toBe('failed');
  });

  it('will abort racers when the run stops', async () => {
    let signal!: AbortSignal;

    class Test extends Steps {
      async run() {
        this.then(this.reply, this.watch());
      }

      protected async watch() {
        signal = this.then.signal;
        await delay(100, signal);
      }

      reply() {}
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(signal).toBeDefined());
    test.then.stop();

    expect(signal.aborted).toBe(true);
    await expect(result).rejects.toMatchObject({ name: 'Stopped' });
  });

  it('will race a group, and retry a caught race', async () => {
    let tries = 0;

    class Test extends Journal {
      async run() {
        this.ask().catch(this.again);
      }

      async ask() {
        this.then(this.reply, this.a(), this.b());
      }

      protected a() {
        if (!tries++) throw new Error('a');
      }

      protected b() {}

      protected again() {
        this.then.retry();
      }

      reply() {}
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(tries).toBe(2));
    await flushMicrotasks();

    expect(test.then.waiting).toHaveLength(1);
    test.reply();
    await result;
    expect(record(test).find((entry) => entry.id == 'ask#1')!.next).toMatchObject([
      { key: 'wait', answers: ['reply'], race: { key: 'then', group: [{ id: 'a#1' }, { id: 'b#1' }] } }
    ]);
  });

  it('will throw if racers are not steps called for it', async () => {
    class Test extends Steps {
      async run() {
        this.then(this.reply, this.then.end() as unknown as Promise<void>);
      }

      reply() {}
    }

    await fails(Test, 'then() races steps called for it - this.then(this.allow, this.timeout(call)).');
  });

  it('will throw if given other functions beside answers', async () => {
    class Test extends Steps {
      async run() {
        this.then(this.reply, () => {});
      }

      reply() {}
    }

    await fails(Test, 'then() takes steps uncalled to answer and called ones to race - not other functions.');
  });

  it('will type racers beside answers', () => {
    class Test extends Steps {
      async run() {
        expectTypeOf(this.then(this.reply, this.timeout(1))).toEqualTypeOf<Promise<void>>();
      }

      protected async timeout(ms: number) {
        this.then({ ms });
        this.reply();
      }

      async reply() {}
    }

    expect(Test.new().then.status).toBe('idle');
  });
});

describe('durations', () => {
  afterEach(() => void vi.useRealTimers());

  it('will wait a duration, summing its units', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

    const later = vi.fn();

    class Test extends Journal {
      async run() {
        this.then({ sec: 1, ms: 500 });
        this.later();
      }

      protected later() {
        later();
      }
    }

    const test = Test.new();
    const now = Date.now();
    const result = test.run();

    await vi.advanceTimersByTimeAsync(0);
    expect(test.then.status).toBe('waiting');
    expect(test.then.waiting).toEqual([{ id: 'wait#1', step: 'run', args: [], answers: [], until: now + 1500 }]);

    await vi.advanceTimersByTimeAsync(1499);
    expect(later).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(later).toHaveBeenCalled();
    expect(record(test)[0].next).toEqual([
      { id: 'wait#1', key: 'wait', args: [1500], answers: [] },
      { id: 'later#1', key: 'later', args: [] }
    ]);
  });

  it('will take minutes, hours and days', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

    class Test extends Journal {
      async run() {
        this.then({ day: 1, hr: 1, min: 1 });
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.advanceTimersByTimeAsync(90_060_000);
    await result;
    expect(record(test)[0].next).toEqual([{ id: 'wait#1', key: 'wait', args: [90_060_000], answers: [] }]);
  });

  it('will clear its timer when the run stops', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

    class Test extends Steps {
      async run() {
        this.then({ min: 1 });
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.advanceTimersByTimeAsync(0);
    test.then.stop();

    await expect(result).rejects.toMatchObject({ name: 'Stopped' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('will not be answered', async () => {
    class Test extends Steps {
      async run() {
        this.then({ min: 1 });
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.then.status).toBe('waiting'));
    test.then.stop();
    await expect(result).rejects.toMatchObject({ name: 'Stopped' });
  });

  it('will throw on an unknown unit, a value not a number, or beside steps', async () => {
    const cases: object[] = [{ secs: 1 }, { sec: '1' }, { sec: -1 }, { toString: 1 }];

    class Empty extends Steps {
      async run() {
        this.then({});
      }
    }

    await fails(Empty, 'then() takes a duration of ms, sec, min, hr and day as numbers - got none.');

    class Test extends Steps {
      async run(duration: object) {
        this.then(duration as { sec: number });
      }
    }

    for (const duration of cases)
      await expect(Test.new().run(duration)).rejects.toThrow(
        `then() takes a duration of ms, sec, min, hr and day as numbers - got ${Object.keys(duration)[0]}.`
      );

    class Beside extends Steps {
      async run() {
        this.then({ sec: 1 }, this.a());
      }

      protected a() {}
    }

    await fails(Beside, 'then() takes a duration alone - this.then({ sec: 10 }).');
  });
});

describe('gate', () => {
  afterEach(() => void vi.useRealTimers());

  const gates = (...keys: string[]) => new Map(keys.map((key) => [key, mockPromise()]));

  it('will run a group at most max at a time, in order', async () => {
    const work = gates('a', 'b', 'c', 'd');
    const started: string[] = [];

    class Test extends Journal {
      async run() {
        this.then(['a', 'b', 'c', 'd'], this.visit);
      }

      protected async visit(site: string) {
        this.then.only(2);
        this.scan(site);
      }

      protected async scan(site: string) {
        started.push(site);
        await work.get(site);
      }
    }

    const [test, result] = await start(Test);

    expect(started).toEqual(['a', 'b']);

    work.get('b')!.resolve();
    await flushMicrotasks();
    expect(started).toEqual(['a', 'b', 'c']);

    work.get('a')!.resolve();
    await flushMicrotasks();
    expect(started).toEqual(['a', 'b', 'c', 'd']);

    work.get('c')!.resolve();
    work.get('d')!.resolve();
    await result;
    expect(record(test)[1].next).toEqual([
      { id: 'gate#1', key: 'gate', args: [] },
      { id: 'scan#1', key: 'scan', args: ['a'] }
    ]);
  });

  it('will follow a max read live', async () => {
    const work = gates('a', 'b', 'c');
    const started: string[] = [];

    class Test extends Steps {
      limit = 1;

      async run() {
        this.then(['a', 'b', 'c'], this.visit);
      }

      protected async visit(site: string) {
        this.then.only(() => this.limit);
        this.scan(site);
      }

      protected async scan(site: string) {
        started.push(site);
        await work.get(site);
      }
    }

    const [test, result] = await start(Test);

    expect(started).toEqual(['a']);

    test.limit = 2;
    await flushMicrotasks();
    expect(started).toEqual(['a', 'b']);

    test.limit = 1;
    work.get('a')!.resolve();
    await flushMicrotasks();
    expect(started).toEqual(['a', 'b']);

    work.get('b')!.resolve();
    await flushMicrotasks();
    expect(started).toEqual(['a', 'b', 'c']);

    work.get('c')!.resolve();
    await result;
  });

  it('will follow a max tracked on another Model', async () => {
    const work = gates('a', 'b', 'c');
    const started: string[] = [];
    const reads = vi.fn();

    class Settings extends Model {
      limit = 1;
    }

    class Test extends Steps {
      settings = new Settings();

      async run() {
        this.then(['a', 'b', 'c'], this.visit);
      }

      protected async visit(site: string) {
        this.then.only(($) => (reads(), $.settings.limit));
        this.scan(site);
      }

      protected async scan(site: string) {
        started.push(site);
        await work.get(site);
      }
    }

    const [test, result] = await start(Test);

    expect(started).toEqual(['a']);

    test.settings.limit = 3;
    await flushMicrotasks();
    expect(started).toEqual(['a', 'b', 'c']);

    reads.mockClear();
    test.settings.limit = 4;
    await flushMicrotasks();
    expect(reads).not.toHaveBeenCalled();

    for (const gate of work.values()) gate.resolve();
    await result;
  });

  it('will stop tracking max once nothing waits', async () => {
    const work = gates('a', 'b');
    const reads = vi.fn();

    class Settings extends Model {
      limit = 1;
    }

    const settings = Settings.new();

    class Test extends Steps {
      settings = settings;

      async run() {
        this.then(['a', 'b'], this.visit);
      }

      protected async visit(site: string) {
        this.then.only(($) => {
          reads(site);
          return $.settings.limit;
        });
        this.scan(site);
      }

      protected async scan(site: string) {
        await work.get(site);
      }
    }

    const [test, result] = await start(Test);

    expect(reads.mock.calls).toEqual([['a'], ['b']]);

    settings.limit = 0.5;
    await flushMicrotasks();
    expect(reads.mock.calls).toEqual([['a'], ['b'], ['b']]);

    work.get('a')!.resolve();
    await flushMicrotasks();
    reads.mockClear();

    settings.limit = 2;
    await flushMicrotasks();
    expect(reads).not.toHaveBeenCalled();

    work.get('b')!.resolve();
    await result;

    settings.limit = 3;
    await flushMicrotasks();
    expect(reads).not.toHaveBeenCalled();
    expect(test.then.status).toBe('idle');
  });

  it('will stop tracking max when the run stops', async () => {
    const reads = vi.fn();

    class Test extends Steps {
      limit = 0;

      async run() {
        this.then.only(($) => (reads(), $.limit));
        this.scan();
      }

      protected async scan() {}
    }

    const [test, result] = await start(Test);

    expect(reads).toHaveBeenCalledTimes(1);

    test.then.stop();
    await expect(result).rejects.toMatchObject({ name: 'Stopped' });

    test.limit = 1;
    await flushMicrotasks();
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it('will read max before the instance is ready', async () => {
    const ready = mockPromise();
    const scan = vi.fn();

    class Test extends Steps {
      limit = 1;

      protected async new() {
        await this.run();
        await ready;
      }

      async run() {
        this.then.only(($) => $.limit);
        this.scan();
      }

      protected async scan() {
        scan();
      }
    }

    Test.new();
    await flushMicrotasks();

    expect(scan).toHaveBeenCalledTimes(1);
    ready.resolve();
  });

  it('will wait a duration before taking a slot', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

    const scan = vi.fn();

    class Test extends Steps {
      async run() {
        this.then({ sec: 1 });
        this.then.only(1);
        this.scan();
      }

      protected async scan() {
        scan();
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.advanceTimersByTimeAsync(999);
    expect(scan).not.toHaveBeenCalled();
    expect(test.then.status).toBe('waiting');

    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it('will share a keyed slot across instances', async () => {
    const lock = {};
    const work = gates('one', 'two');
    const started: string[] = [];

    class Test extends Steps {
      name = '';

      async run() {
        this.then.only(1, lock);
        this.work();
      }

      protected async work() {
        started.push(this.name);
        await work.get(this.name);
      }
    }

    const one = Test.new({ name: 'one' });
    const two = Test.new({ name: 'two' });
    const done = Promise.all([one.run(), two.run()]);

    await flushMicrotasks();
    expect(started).toEqual(['one']);

    work.get('one')!.resolve();
    await flushMicrotasks();
    expect(started).toEqual(['one', 'two']);

    work.get('two')!.resolve();
    await done;
  });

  it('will share a primitive key across groups of one instance', async () => {
    const work = gates('x', 'y');
    const started: string[] = [];

    class Test extends Steps {
      async run() {
        this.then(this.one(), this.two());
      }

      protected async one() {
        this.then(['x'], this.work);
      }

      protected async two() {
        this.then(['y'], this.work);
      }

      protected async work(name: string) {
        this.then.only(1, 'db');
        this.query(name);
      }

      protected async query(name: string) {
        started.push(name);
        await work.get(name);
      }
    }

    const [, result] = await start(Test);

    expect(started).toEqual(['x']);

    work.get('x')!.resolve();
    await flushMicrotasks();
    expect(started).toEqual(['x', 'y']);

    work.get('y')!.resolve();
    await result;
  });

  it('will slot a step outside any group on the instance', async () => {
    const order: string[] = [];

    class Test extends Journal {
      async run() {
        this.then.only(1);
        this.a();
        this.b();
      }

      protected async a() {
        this.then.only(1);
        order.push('a');
      }

      protected async b() {
        order.push('b');
      }
    }

    const [test] = await ran(Test);

    expect(order).toEqual(['a', 'b']);
    expect(record(test)[0].next.map((node) => node.id)).toEqual(['gate#1', 'a#1', 'b#1']);
  });

  it('will re-enter a slot held above it', async () => {
    const done = vi.fn();

    class Test extends Steps {
      async run() {
        this.then(['a', 'b'], this.visit);
      }

      protected async visit(site: string) {
        this.then.only(1);
        this.inner(site);
      }

      protected async inner(site: string) {
        this.then.only(1);
        this.finish(site);
      }

      protected async finish(site: string) {
        done(site);
      }
    }

    await ran(Test);

    expect(done.mock.calls).toEqual([['a'], ['b']]);
  });

  it('will queue a retry behind those waiting', async () => {
    const scanned: string[] = [];
    let failed = false;

    class Test extends Steps {
      async run() {
        this.then(['a', 'b', 'c'], (site) => this.visit(site).catch(this.again));
      }

      protected async visit(site: string) {
        this.then.only(1);
        this.scan(site);
      }

      protected async scan(site: string) {
        scanned.push(site);
        await Promise.resolve();

        if (site == 'a' && !failed) {
          failed = true;
          throw new Error('down');
        }
      }

      protected async again() {
        this.then.retry();
      }
    }

    await Test.new().run();
    expect(scanned).toEqual(['a', 'b', 'c', 'a']);
  });

  it('will not hold a slot through a retry\'s backoff', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

    const scanned: string[] = [];
    let failed = false;

    class Test extends Steps {
      async run() {
        this.then(['a', 'b'], (site) => this.visit(site).catch(this.again));
      }

      protected async visit(site: string) {
        if (this.then.retried) this.then({ sec: 1 });

        this.then.only(1);
        this.scan(site);
      }

      protected async scan(site: string) {
        scanned.push(site);

        if (site == 'a' && !failed) {
          failed = true;
          throw new Error('down');
        }
      }

      protected async again() {
        this.then.retry();
      }
    }

    const result = Test.new().run();

    await vi.advanceTimersByTimeAsync(0);
    expect(scanned).toEqual(['a', 'b']);

    await vi.advanceTimersByTimeAsync(1000);
    await result;
    expect(scanned).toEqual(['a', 'b', 'a']);
  });

  it('will not deadlock a retry under a slot held above its issuer', async () => {
    const scanned: string[] = [];
    let failed = false;

    class Test extends Steps {
      async run() {
        this.then.only(1, 'db');
        this.visit('a').catch(this.again);
      }

      protected async visit(site: string) {
        this.then.only(1, 'db');
        this.scan(site);
      }

      protected async scan(site: string) {
        scanned.push(site);

        if (!failed) {
          failed = true;
          throw new Error('down');
        }
      }

      protected async again() {
        this.then.retry();
      }
    }

    await Test.new().run();
    expect(scanned).toEqual(['a', 'a']);
  });

  it('will release slots when a run fails', async () => {
    const lock = {};
    const gate = mockPromise();
    const work = vi.fn();

    class Failing extends Steps {
      async run() {
        this.then.only(1, lock);
        this.fail();
        this.then.only(1, lock);
        this.never();
      }

      protected async fail() {
        await gate;
        throw new Error('boom');
      }

      protected async never() {
        work('never');
      }
    }

    class Other extends Steps {
      async run() {
        this.then.only(1, lock);
        this.work();
      }

      protected async work() {
        work('other');
      }
    }

    const failing = Failing.new();
    const other = Other.new();
    const failed = failing.run();

    await flushMicrotasks();

    const waiting = other.run();

    await flushMicrotasks();
    expect(work).not.toHaveBeenCalled();

    const failure = expect(failed).rejects.toThrow('boom');

    gate.reject(new Error('boom'));

    await waiting;
    await failure;
    expect(work.mock.calls).toEqual([['other']]);
  });

  it('will release held and pending slots when stopped', async () => {
    const lock = {};
    const gate = mockPromise();
    const work = vi.fn();

    class Holder extends Steps {
      async run() {
        this.then(['a', 'b'], this.visit);
      }

      protected async visit(site: string) {
        this.then.only(1, lock);
        this.hold(site);
      }

      protected async hold(site: string) {
        work(site);
        await gate;
      }
    }

    class Other extends Steps {
      async run() {
        this.then.only(1, lock);
        this.work();
      }

      protected async work() {
        work('other');
      }
    }

    const holder = Holder.new();
    const other = Other.new();
    const stopped = holder.run();

    await flushMicrotasks();

    const waiting = other.run();

    await flushMicrotasks();
    expect(work.mock.calls).toEqual([['a']]);

    holder.then.stop();
    await waiting;
    expect(work.mock.calls).toEqual([['a'], ['other']]);

    gate.resolve();
    await expect(stopped).rejects.toThrow('was stopped');
    expect(work.mock.calls).toEqual([['a'], ['other']]);
  });

  it('will release slots when ended from outside', async () => {
    const lock = {};
    const gate = mockPromise();

    class Test extends Steps {
      async run() {
        this.then.only(1, lock);
        this.hold();
      }

      protected async hold() {
        await gate;
      }
    }

    const one = Test.new();
    const two = Test.new();
    const ended = one.run();

    await flushMicrotasks();

    const waiting = two.run();

    one.then.end();
    gate.resolve();

    await ended;
    expect(one.then.status).toBe('idle');
    await waiting;
  });

  it('will cancel a slot whose step a caught failure discards', async () => {
    const never = vi.fn();
    const caught = vi.fn();

    class Test extends Steps {
      async run() {
        this.then(this.first(), this.second()).catch(caught);
      }

      protected async first() {
        this.then.only(0);
        this.never();
      }

      protected async second() {
        this.then(this.waiter(), this.third());
      }

      protected async waiter() {
        this.then.only(0, 'other');
        this.never();
      }

      protected async third() {
        throw new Error('reset');
      }

      protected async never() {
        never();
      }
    }

    await Test.new().run();
    expect(caught).toHaveBeenCalledWith(new Error('reset'));
    expect(never).not.toHaveBeenCalled();
  });

  it('will not reach a slot after a failure', async () => {
    const never = vi.fn();

    class Test extends Steps {
      async run() {
        this.then(this.fail(), this.slow());
      }

      protected async fail() {
        throw new Error('boom');
      }

      protected async slow() {
        await Promise.resolve();
        this.then.only(1);
        this.never();
      }

      protected async never() {
        never();
      }
    }

    await fails(Test, 'boom');

    expect(never).not.toHaveBeenCalled();
  });

  it('will throw outside a step, or without a count', async () => {
    class Test extends Steps {
      async run() {
        this.then.only('1' as never);
      }
    }

    expect(() => Test.new().then.only(1)).toThrow('only must be called inside a step.');
    await fails(Test, 'only() takes a count, or a function returning one.');
  });

  it('will type a count read from the instance', () => {
    class Test extends Steps {
      limit = 1;

      async run() {
        expectTypeOf(this.then.only(($) => $.limit)).toEqualTypeOf<void>();
      }
    }

    expect(Test.new().then.status).toBe('idle');
  });
});

describe('races and halts', () => {
  afterEach(() => void vi.useRealTimers());

  it('will not restore a loser\'s field over a write made since the race was decided', async () => {
    class Test extends Steps {
      note = 'start';

      async run() {
        this.then(this.allow, this.timeout());

        await this;

        return this.note;
      }

      protected async timeout() {
        this.note = 'waiting';
        this.then({ sec: 10 });
      }

      async allow() {
        this.note = 'approved';
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.note).toBe('waiting'));
    test.allow();

    expect(await result).toBe('approved');
  });

  it('will wait a duration longer than a timer can hold', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

    const DAY = 86_400_000;

    class Test extends Steps {
      async run() {
        this.then({ day: 30 });
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.advanceTimersByTimeAsync(25 * DAY);
    expect(test.then.status).toBe('waiting');

    await vi.advanceTimersByTimeAsync(5 * DAY);
    await result;
    expect(test.then.status).toBe('idle');
  });

  it('will let a loser\'s undo in flight finish when aborted, then undo the rest', async () => {
    const log: string[] = [];
    const slow = mockPromise();

    class Test extends Steps {
      async run() {
        this.setup();
      }

      protected async setup() {
        this.then.on({ reset: () => void log.push('unsetup') });
        this.then(this.allow, this.timeout());
      }

      protected async timeout() {
        this.then.on({ reset: this.untimeout() });
        this.then({ sec: 10 });
      }

      protected async untimeout() {
        const { signal } = this.then;

        log.push('untimeout');
        await new Promise((resolve, reject) => {
          slow.then(resolve);
          signal.addEventListener('abort', () => reject(signal.reason));
        });
        log.push('untimeout done');
      }

      async allow() {}
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.then.waiting).toHaveLength(2));
    test.allow();
    await vi.waitFor(() => expect(log).toEqual(['untimeout']));

    test.then.abort();
    slow.resolve();

    await expect(result).rejects.toMatchObject({ name: 'Aborted' });
    expect(log).toEqual(['untimeout', 'untimeout done', 'unsetup']);
  });

  it('will close above a race only once its losers are unwound', async () => {
    const log: string[] = [];
    const slow = mockPromise();

    class Test extends Steps {
      async run() {
        this.setup();
      }

      protected async setup() {
        this.then.on({ abort: (...args) => void log.push(`abort setup ${args.length}`), close: () => void log.push('close setup') });
        this.then(this.allow, this.timeout());
      }

      protected async timeout() {
        this.then.on({ reset: this.untimeout() });
        this.then({ sec: 10 });
      }

      protected async untimeout() {
        log.push('untimeout');
        await slow;
        log.push('untimeout done');
      }

      async allow() {}
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.then.waiting).toHaveLength(2));
    test.allow();
    await vi.waitFor(() => expect(log).toEqual(['untimeout']));

    test.then.stop();
    slow.resolve();

    await expect(result).rejects.toMatchObject({ name: 'Stopped' });
    expect(log).toEqual(['untimeout', 'untimeout done', 'abort setup 0', 'close setup']);
  });

  it('will journal a step once when its after hook throws', async () => {
    const undo = vi.fn();

    class Test extends Steps {
      async run() {
        this.first();
      }

      protected async first() {
        this.then.on({ reset: undo });
      }

      protected after(key: string) {
        if (key == 'first') throw new Error('after');
      }
    }

    await fails(Test, 'after');
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('will finish the run in its tail when stopped, rejecting the queue', async () => {
    const work = mockPromise();
    const tail = vi.fn();

    class Test extends Steps {
      async run(value: number) {
        await this;
        tail();
        await work;

        return value;
      }
    }

    const test = Test.new();
    const first = test.run(1);

    await vi.waitFor(() => expect(tail).toHaveBeenCalled());

    const second = test.run(2);

    test.then.stop();
    work.resolve();

    expect(await first).toBe(1);
    await expect(second).rejects.toMatchObject({ name: 'Stopped' });
  });

  it('will give a loser\'s throwing undo the race as cause', async () => {
    class Test extends Steps {
      async run() {
        this.then(this.allow, this.timeout());
      }

      protected async timeout() {
        this.then.on({
          reset: () => {
            throw new Error('undo');
          }
        });
        this.then({ sec: 10 });
      }

      async allow() {}
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.then.waiting).toHaveLength(2));
    test.allow();

    const error = await result.catch((error) => error);

    expect(error.message).toBe('undo');
    expect(error.cause).toMatchObject({ name: 'Aborted', message: 'allow answered wait#1.' });
    expect(test.then.status).toBe('failed');
  });

  it('will take a loser rejecting after the race as the loss', async () => {
    const slow = mockPromise();

    class Test extends Journal {
      async run() {
        this.then(this.allow, this.poll());
      }

      protected async poll() {
        await slow;
        throw new Error('poll');
      }

      async allow() {}
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.then.active).toBe('poll'));
    test.allow();
    slow.resolve();

    await result;
    expect(test.then.status).toBe('idle');
    expect(record(test).find((entry) => entry.key == 'poll')).toMatchObject({ error: new Error('poll') });
  });

  it('will call a handler plainly, not on the instance', async () => {
    let self: unknown = 'unset';

    class Test extends Steps {
      async run() {
        this.a();
      }

      protected async a() {
        this.then.on({
          close() {
            self = this;
          }
        });
      }
    }

    await Test.new().run();
    expect(self).toBeUndefined();
  });

  it('will keep a key an arrow handler writes through the step', async () => {
    class Test extends Steps {
      status = '';

      async run() {
        this.a();
      }

      protected async a() {
        this.status = 'running';
        this.then.on({
          abort: async (error) => {
            if (error) return;

            this.status = 'cancelled';
            await Promise.resolve();
          }
        });
        this.slow();
      }

      protected async slow() {
        const { signal } = this.then;

        await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
      }
    }

    const test = Test.new();
    const result = test.run();

    await vi.waitFor(() => expect(test.then.active).toBe('slow'));
    test.then.abort();

    await expect(result).rejects.toMatchObject({ name: 'Aborted' });
    expect(test.status).toBe('cancelled');
  });
});

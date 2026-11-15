import { Model, unbind } from '@expressive/mvc';
import { event, listener, touch } from '@expressive/mvc/observable';

import { Control } from './control';
import { HOOKS, KEYS, REFRESH, RESERVED, outside, rule, valueless } from './util';

declare namespace Steps {
  /**
   * Where the instance stands - reactive through `then.status`.
   *
   * `idle` - no run, or the last ended cleanly. `running`. `waiting` - parked on an open wait.
   * `stopped`, `aborted`, `failed` - how the last run ended; held until the next one starts.
   */
  type Status = 'idle' | 'running' | 'waiting' | 'stopped' | 'aborted' | 'failed';

  /** The run's result - what `run` resolves with; types `x.run()` and `await x`. */
  type Result<T> = T extends { run(...args: any[]): infer R } ? Awaited<R> : unknown;

  /** A planned item: a step, a parallel group (`group`), or a wait (`answers`). */
  interface Node {
    id: string;
    key: string;
    /** Arguments - a duration wait's milliseconds. */
    args: unknown[];
    group?: Node[];
    /** Keys of the steps which may answer this wait - none for a duration. */
    answers?: string[];
    /** Steps raced against the answers - cancelled once one answers. */
    race?: Node;
    /** Caught by `.catch()`: a step given the error (its key), `then` for a function, or `true` for none. */
    rescue?: string | true;
  }

  /** What calling a step inside a step returns - inert, not awaitable; scheduled once the caller settles. */
  type Token = Readonly<Node>;

  /**
   * A committed step, as `after` receives it - keys and arguments, no values.
   *
   * `id` is `key#n`, e.g. `pay#1`. The Runner keeps no journal - collect entries in `after`.
   */
  interface Entry {
    id: string;
    key: string;
    args: unknown[];
    /** What the step scheduled. */
    next: Node[];
    /** Fields the step wrote, collections changed in place included. */
    wrote: string[];
    /** Handlers the step registered with `then.on()`, by outcome, in order: a step method given uncalled or steps called for one (by key), or `then` for a function. */
    on?: { [K in keyof On]?: Node[] };
    /** Taken back by an unwind - resets run, fields restored; `'failed'` when a handler threw. */
    unwound?: true | 'failed';
    /** Id of the wait this step answered. */
    wake?: string;
    /** How many times `then.retry()` replayed the step, when past its first run. */
    retried?: number;
    /** What the step threw - a caught failure, or one which kept its writes. */
    error?: unknown;
    /** Collections changed in a way no restore can undo - the unwind stops here. */
    irreversible?: string[];
    /** The step called `then.commit()` - not retried, restored or undone; the unwind stops here. */
    committed?: true;
    /** The unwind stopped at this entry; it and every entry before it stay applied. */
    halted?: true;
    /** An `end` the runtime added - the plan drained without one. */
    implicit?: true;
  }

  /** An open wait, as listed by `then.waiting`. */
  interface Wait {
    id: string;
    /** Key of the step which opened the wait. */
    step: string;
    /** Arguments of the step which opened the wait. */
    args: unknown[];
    /** Keys of the steps which may answer it. */
    answers: string[];
    /** When a duration wait closes, in epoch milliseconds. */
    until?: number;
  }

  /**
   * A `then.on` handler.
   *
   * A function - given the error, or nothing on a cancellation; process-local. For a durable run:
   * a step method uncalled - given the same, recorded - or steps called for it, an array a group.
   */
  type Handler = { handler(reason?: unknown): unknown }['handler'] | Promise<void> | readonly Promise<void>[];

  /**
   * Handlers for the outcomes of a step and everything it schedules.
   *
   * Per step they fire `catch`, `abort`, `reset`, `close`; across steps deepest first, newest first.
   * Handlers run before fields are restored and see the step's partial writes; keys they write are kept.
   */
  interface On {
    /**
     * The step is taken back - reset its effects.
     *
     * A failure leaving its subtree, `abort()`, a lost race; not `stop()`. Fields are restored after it.
     */
    reset?: Handler;
    /**
     * A failure below that no closer `.catch` took - return to recover, throw to pass it on.
     *
     * Recovering unwinds the failed part of the subtree; the step's own effects stay and its `reset`
     * does not run; steps it schedules replace the rest. One per step; runs before a `.catch` on the
     * step's call. `then.retry()` replays the step.
     */
    catch?: Handler;
    /**
     * The subtree ended without completing - `commit()`'s counterpart.
     *
     * Given the error of a failure no `catch` recovered; nothing for a cancellation (`abort()`, `stop()`,
     * a lost race) - `then.status` tells which. Skips a clean end, a recovered failure and `then.end()`.
     */
    abort?: Handler;
    /** The subtree ended, any way - a finally over it, last. */
    close?: Handler;
  }

  /** Why a run or subtree ended: `abort()`, or a lost race. */
  type Aborted = InstanceType<typeof Steps.Aborted>;
  /** Why a run or subtree ended: `stop()`. */
  type Stopped = InstanceType<typeof Steps.Stopped>;

  /** A plain copy of the controller's reactive fields - `then.get()`. */
  interface Snapshot {
    status: Status;
    active: string | undefined;
    queue: unknown[][];
    waiting: Wait[];
    runs: number;
    error: unknown;
  }

  interface Controller<T extends Model = Model> {
    /**
     * Inside a step: park the plan for a duration - units summed.
     *
     * A wait nothing answers, journaled `wait#n` with `args: [ms]`. The next step in sequence runs once
     * it passes - backoff, timeouts, nudges.
     *
     * @example
     * this.then({ sec: 30 });
     * this.retryUpload();
     */
    <This>(this: This, duration: { ms?: number; sec?: number; min?: number; hr?: number; day?: number }): Promise<void>;

    /**
     * Inside a step: one parallel group of `each`, called per item.
     *
     * `each` is a function issuing a step, or a step itself. The next step in sequence runs once every
     * member, and all it schedules, is done.
     *
     * @example
     * this.then(this.files, this.upload);
     * this.then(this.sites, (site) => this.scan(site, 'deep'));
     */
    <I, This>(this: This, items: Iterable<I>, each: (item: I, index: number) => unknown): Promise<void>;

    /**
     * Inside a step: park the plan until one of these steps is called.
     *
     * Status `waiting`. Answering steps read `undefined` from outside unless an open wait accepts them.
     * An outside call answers the wait whose opening step's first argument `===` its own, else the
     * oldest; its Promise resolves when that answer's subtree is done. A call no wait accepts throws.
     *
     * @example
     * this.then(this.approve, this.reject);
     */
    <This>(this: This, ...steps: ((...args: any[]) => unknown)[]): Promise<void>;

    /**
     * Inside a step: run these tokens as one parallel group.
     *
     * The next step in sequence runs once every member, and all it schedules, is done. Beside steps
     * uncalled, each called step is a racer, started when the plan reaches the wait: the first answer
     * wins and keeps all it did; losers' signals abort, what they scheduled drops, and each losing
     * branch unwinds - resets run, fields restored.
     *
     * @example
     * this.then(this.ship(order), this.receipt(order));
     * this.then(this.allow, this.deny, this.timeout(call));
     */
    <This>(this: This, ...steps: unknown[]): Promise<void>;

    /** The instance this controller runs. */
    readonly self: T;
    /** Where the instance stands - see {@link Steps.Status}. */
    readonly status: Steps.Status;
    /** Key of a step in flight - the latest invoked, with a group in flight. */
    readonly active: string | undefined;
    /** Arguments of each `run()` waiting for the active run to finish. */
    readonly queue: readonly unknown[][];
    /** Open waits, oldest first - durations included. */
    readonly waiting: readonly Steps.Wait[];
    /** Runs finished - ended, failed, stopped or aborted. */
    readonly runs: number;
    /** What failed the last run; cleared when the next starts. */
    readonly error: unknown;

    /** A plain snapshot of status, active, queue, waiting, runs and error. */
    get(): Steps.Snapshot;

    /**
     * End the run early, keeping everything.
     *
     * Inside a step, where the plan reaches it; from outside, now. Steps in flight settle, what they
     * schedule drops, only `close` fires; `run`'s tail then builds the result from fields. Takes no
     * value - write why it ended to a field first. To halt now, `stop()` or `abort()`.
     *
     * @example
     * if (this.found) this.then.end();
     * else this.next();
     */
    end(): void;

    /**
     * Inside a step: a gate - only `max` at once; what the step schedules after it holds a slot until done.
     *
     * Queues FIFO. `max` as a function of `$`, the tracking proxy, is re-read live; `0` pauses. `key`
     * shares the queue: an object across groups and instances (`only(1, this.manager)` is a mutex), any
     * other value across this instance. Default: the enclosing group's, else the instance's. A delay
     * before queueing is a duration ahead of it.
     *
     * @example
     * this.then.only(($) => $.concurrency);
     * this.upload(file);
     */
    only(max: number | (($: T) => number), key?: unknown): void;

    /**
     * Halt, keeping what was done - status `stopped`.
     *
     * Pending steps and queued runs drop; in-flight steps settle and commit. The run, the queue and
     * in-flight signals reject with a `Steps.Stopped` - `reason` as its `cause`, and its message when a string.
     * `set(null)` on the instance stops too.
     */
    stop(reason?: unknown): void;

    /**
     * Halt and unwind, as a failure would - status `aborted`.
     *
     * The run's resets run, newest first, and fields are restored. The run and queue reject with a
     * `Steps.Aborted`, `reason` as for `stop`. A reset which throws fails the run: its error, given the
     * `Steps.Aborted` as `cause`.
     */
    abort(reason?: unknown): void;

    /**
     * Inside a step: a point of no return.
     *
     * The step is not caught, retried, restored or undone; an unwind stops here and what came before stands.
     */
    commit(): void;

    /**
     * Inside a step: handlers for the outcomes of this step and all it schedules - see {@link Steps.On}.
     *
     * Register right after the effect it undoes. An unknown key throws.
     *
     * @example
     * const hold = await inventory.hold(this.cart.items);
     *
     * this.then.on({ reset: () => inventory.release(hold) });
     * this.pay();
     */
    on(handlers: Steps.On): void;

    /** Inside a `.catch` handler: restore the caught branch's fields now; writes after it stand. */
    restore(): void;

    /**
     * Inside a step: its `AbortSignal` - pass it to the call the step awaits.
     *
     * Aborted on `stop()` or `abort()`, an outside `end`, a failure elsewhere, a race lost, and once the
     * step settles. A step rejecting with its reason is not a failure.
     *
     * @example
     * this.page = await fetch(this.url, { signal: this.then.signal });
     */
    readonly signal: AbortSignal;

    /** Inside a step: how many times `then.retry()` replayed it - `0` on a first run. In a handler, the failed one's. */
    readonly retried: number;

    /**
     * Inside a `.catch` handler: schedule what the catch is attached to again, under the same handler.
     *
     * The failed step or the whole group, with its recorded args. The handler holds the policy; backoff
     * belongs in the retried step. Throws outside a handler.
     *
     * @example
     * this.scan(site).catch((error) => {
     *   if (this.then.retried >= 3) throw error;
     *   this.then.retry();
     * });
     */
    retry(): void;
  }

  interface Thenable<T extends Model = Model> {
    /**
     * Join the active run - or, idle, call `run()`; settles with the last queued run's result.
     *
     * Rejects if idle and `run` takes arguments - give an optional one a default.
     */
    <R1 = Steps.Result<T>, R2 = never>(
      onfulfilled?: ((value: Steps.Result<T>) => R1 | PromiseLike<R1>) | null,
      onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
    ): Promise<R1 | R2>;

    then: Steps.Runner<T>;
  }

  /** The controller, and a thenable - so the instance, with it as `then`, is awaitable. */
  type Runner<T extends Model = Model> = Controller<T> & Thenable<T>;
}

function install<T extends Steps>(self: T) {
  const runner = function (onfulfilled?: unknown, onrejected?: unknown) {
    if (onfulfilled && typeof onfulfilled == 'object') throw rule('then(steps) must be called inside a step.');

    return control.settled().then(onfulfilled as any, onrejected as any);
  } as Steps.Runner<T>;

  const control = Control.new({ _self: self, _runner: runner });

  const read: Record<(typeof KEYS)[number], () => unknown> = {
    status: () => control.status,
    active: () => control.active,
    queue: () => control.queue.map((ticket) => ticket.args),
    waiting: () => control.run.waits.map(({ id, step, args, answers, until }) => ({ id, step, args, answers, ...until !== undefined && { until } })),
    runs: () => control.runs,
    error: () => control.error
  };

  for (const key of KEYS)
    Object.defineProperty(runner, key, {
      enumerable: true,
      get(this: object) {
        return touch(this, key, read[key]());
      }
    });

  Object.defineProperties(runner, {
    then: { value: runner },
    self: { value: self },
    get: { value: () => Object.fromEntries(KEYS.map((key) => [key, read[key]()])) },
    end: { value: (...value: unknown[]) => void (valueless(value), control.conclude()) },
    stop: { value: (reason?: unknown) => control.stop(false, reason) },
    abort: { value: (reason?: unknown) => control.stop(true, reason) },
    only: { value: () => outside('only') },
    commit: { value: () => outside('commit') },
    on: { value: () => outside('on') },
    restore: { value: () => outside('restore') },
    signal: { get: () => outside('signal', 'read') },
    retry: { value: () => outside('retry') },
    retried: { get: () => outside('retried', 'read') }
  });

  event(runner);

  Object.defineProperty(self, 'then', {
    configurable: true,
    get(this: object) {
      const view = touch(this, 'then', runner);

      return view === runner ? runner : Object.setPrototypeOf((...args: [any?, any?]) => runner(...args), view);
    }
  });

  const { _hooks: hooks, _steps: steps } = control;

  const wire = () => {
    for (const key of steps.keys()) delete (self as any)[key];

    steps.clear();
    hooks.clear();

    for (let proto = Object.getPrototypeOf(self); proto !== Model.prototype; proto = Object.getPrototypeOf(proto))
      for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
        let method = desc.get && unbind(desc.get) !== desc.get;
        let skip = !method || key == 'new' || key[0] == '_' || Object.hasOwn(self, key);

        if (skip) continue;

        if (key == 'end') throw rule(`${self.constructor.name} declares end; return the result from run, end early with this.then.end().`);
        if (RESERVED.includes(key)) throw rule(`${self.constructor.name} declares ${key}; then, end, gate and wait name plan tokens - rename the step.`);

        if (HOOKS.has(key)) {
          if (!hooks.has(key)) hooks.set(key, unbind(desc.get!));
          continue;
        }

        const step = (...args: unknown[]) => control.call(key, args);

        steps.set(key, unbind(desc.get!));
        Object.defineProperty(
          self,
          key,
          key == 'run'
            ? { value: step, writable: true, configurable: true }
            : {
                configurable: true,
                get(this: object) {
                  touch(this, key);
                  return control.accepts(key) ? step : undefined;
                }
              }
        );
      }
  };

  wire();
  listener(self, (key) => void (key === REFRESH && wire()));

  self.get(null, () => control.stop());
}

class Aborted extends Error {
  override name = 'Aborted';
}

class Stopped extends Error {
  override name = 'Stopped';
}

/**
 * A runnable Model: every method is a step, a step schedules the next by calling it.
 *
 * Fields carry data between steps. Each step is atomic and registers its own reset; a failure unwinds
 * what committed. `run()` starts a run; awaiting the instance joins it. In-process only.
 *
 * @example
 * class Checkout extends Steps {
 *   cart!: Cart;
 *   charge?: Charge = undefined;
 *
 *   async run() {
 *     this.pay();
 *     await this;
 *     return this.charge!.id;
 *   }
 *
 *   protected async pay() {
 *     this.charge = await stripe.charge(this.cart.total);
 *     this.then.on({ reset: () => stripe.refund(this.charge!.id) });
 *   }
 * }
 *
 * const id = await Checkout.new({ cart });
 */
class Steps extends Model {
  /** Why a run or subtree ended: `abort()`, or a lost race. */
  static readonly Aborted = Aborted;
  /** Why a run or subtree ended: `stop()`. */
  static readonly Stopped = Stopped;

  /**
   * The controller - plan tokens inside a step, status and control from outside.
   *
   * Its fields are reactive through the instance: `x.get(($) => $.then.status)`, or read in a render.
   * Enumerable - `{ ...x.then }` snapshots; not in `instance.get()`. Awaiting the instance awaits it.
   */
  declare readonly then: Steps.Runner<this>;

  constructor(...args: Model.Args) {
    super(...args);
    install(this);
  }

  /**
   * The entry - starts a run, or queues one while a run is active; settles with what it returns.
   *
   * Must be `async`; the only step callable from outside. Before `await this`: field writes and step
   * calls only. After it, the tail: read fields, return or throw - step calls throw. Without `await this`
   * it settles at once. `return await this` is a TS circularity - return from fields. Inside a step,
   * `this.run()` throws.
   *
   * @example
   * async run(url: string) {
   *   this.fetch(url);
   *   await this;
   *   return this.rows;
   * }
   */
  run?(...args: any[]): Promise<unknown>;

  /** Hook: before each step. Synchronous, the raw instance as `this`; writes are unjournaled. */
  protected before?(step: string, args: unknown[]): void;

  /**
   * Hook: after each step commits, given its entry - the only journal there is.
   *
   * Synchronous, the raw instance as `this`; writes are unjournaled. A try a catch took, and the failure
   * ending the run, arrive with `entry.error`; a called `end` arrives too, an implicit one does not.
   *
   * @example
   * protected after(step: string, entry: Steps.Entry) {
   *   this.log.push(entry);
   * }
   */
  protected after?(step: string, entry: Steps.Entry): void;
}

export { Aborted, Steps, Stopped };

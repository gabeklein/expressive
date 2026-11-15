import { get, Model } from '@expressive/mvc';

import { collection, mutators } from './collections';
import { Run } from './run';
import { Steps } from './steps';
import type { Change, Collection, Handler, Kind, Log, Restore, Slot } from './types';
import { ISSUED, KINDS, RETRY, SLACK, UNCAUGHT, UNITS, UNPLANNED, adopt, grouped, iterable, named, plain, rule, valueless } from './util';

class Frame extends Model {
  run = get(Run);
  id = '';
  key = '';
  args: unknown[] = [];

  _proxy!: Model;
  _owner?: Frame = undefined;
  _view?: Steps.Controller = undefined;
  _refs = new Map<string, Function>();
  _abort = new AbortController();
  _items: Steps.Node[] = [];
  _wrote = new Set<string>();
  _prior: Record<string, unknown> = {};
  _wrappers = new Map<Collection, Collection>();
  _log: Log = [];
  _on: Handler[] = [];
  _changed = new Set<string>();
  _lost = new Set<string>();
  _wake?: string = undefined;
  _undo?: boolean = undefined;
  _retried = 0;
  _restore?: Restore = undefined;
  _caught?: Steps.Node = undefined;
  _failed?: { cause: unknown } = undefined;
  _committed?: boolean = undefined;
  _entry?: Steps.Entry = undefined;
  _fixed?: Steps.Entry = undefined;
  _violation?: string = undefined;
  _late?: boolean = undefined;
  _armed = 0;
  _settled?: boolean = undefined;
  _point?: (done: (value?: unknown) => void, fail: (error: unknown) => void) => void = undefined;

  protected new() {
    const { _self: self, _steps, _runner } = this.run.control;

    this._proxy = new Proxy(self, {
      get: (target, prop) => {
        const live = this._settled && this.live();

        if (live) return Reflect.get(live._proxy, prop);
        if (_steps.has(prop as string)) return this.ref(prop as string);

        const value = Reflect.get(target, prop, target);

        if (value === _runner) return this.view();

        let managed = !this._undo && !this._settled && collection(value);

        return managed ? this.wrap(prop as string, value) : value;
      },
      set: (target, prop, value) => {
        const key = String(prop);

        if (this._settled) {
          const live = this.live();

          return live ? Reflect.set(live._proxy, prop, value) : Reflect.set(target, prop, value, target);
        }

        if (!this._wrote.has(key)) {
          this._prior[key] = Reflect.get(target, prop, target);
          this._wrote.add(key);
        }

        if (this._items.length) this._violation ||= key;

        this.run._writer.set(key, this.id);

        return Reflect.set(target, prop, value, target);
      }
    });

    return () => this._abort.abort();
  }

  live() {
    const { run } = this;

    if (run.waits.any((wait) => wait._from === this)) return;

    const live = [...run.frames].filter((frame) => frame.within(this));

    return live.length == 1 ? live[0] : undefined;
  }

  within(owner: Frame) {
    for (let at = this._owner; at; at = at._owner) if (at === owner) return true;

    return false;
  }

  ref(key: string) {
    let ref = this._refs.get(key);

    if (!ref) this._refs.set(key, (ref = (...args: unknown[]) => (this._settled ? this.answer(key, args) : this.issue(key, args))));

    return ref;
  }

  keyOf(fn: unknown) {
    for (const [key, ref] of this._refs) if (ref === fn) return key;
  }

  issue(key: string, args: unknown[]) {
    const { run } = this;

    if (this._undo && UNPLANNED.includes(key)) throw rule(`${named(key)} cannot run in an undo.`);
    if (this._settled) throw rule(`${this.key} has settled; ${key} cannot run.`);
    if (key == 'run') throw rule('run is the entry - loop with a step: a step which schedules itself again.');

    const token = run.node(key, args);

    ISSUED.set(token, this);
    this._items.push(token);
    this.arm();

    return token;
  }

  answer(key: string, args: unknown[]) {
    const { run } = this;
    let live = run.control._current === run;
    const wait = live && run.route(key, args, this);

    if (wait) return run.wake(wait, key, args);

    throw rule(`${this.key} has settled; ${key} cannot run.`);
  }

  async pause(pending: Promise<unknown>) {
    const { signal } = this._abort;
    const abort = new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    let failed: { cause: unknown } | undefined;

    if (!signal.aborted) await Promise.race([pending, abort]).catch((cause) => (failed = { cause }));
    if (signal.aborted) throw signal.reason;

    return failed;
  }

  open(call: unknown) {
    const { run } = this;
    const body = Promise.resolve(call);

    body.catch(() => {});
    this.arm();

    return new Promise((resolve, reject) => {
      this._point = (done, fail) => {
        if (this._late) {
          const error = rule('run awaited work before its plan - it takes arguments, calls steps and awaits this.');

          fail(error);
          return reject(error);
        }

        run._await = { resolve: done, reject: fail };
        run._tail = body;
        resolve(undefined);
      };

      body.then(
        (value) => {
          if (run._tail) return;

          run._result = value;
          resolve(undefined);
        },
        (error) => {
          if (!run._tail) reject(error);
        }
      );
    });
  }

  arm() {
    const armed = ++this._armed;
    let hops = SLACK;

    const tick = () => {
      if (this._settled || this._armed != armed) return;
      if (--hops) queueMicrotask(tick);
      else this._late = true;
    };

    queueMicrotask(tick);
  }

  view(): Steps.Controller {
    if (this._view) return this._view;

    const retry = () => this.retry();

    RETRY.add(retry);

    const view = (...args: unknown[]) => {
      const [items, each] = args as [unknown, (item: unknown, index: number) => unknown];
      const fns = args.filter((arg) => typeof arg == 'function');
      const refs = fns.map((fn) => this.keyOf(fn)).filter(Boolean) as string[];
      const tokens = args.filter((arg) => arg && typeof arg == 'object');
      let timed = args.some(plain);
      let mapped = args.length == 2 && iterable(items) && typeof each == 'function';
      let grouped = args.length && tokens.length == args.length;
      let waits = refs.length && refs.length == fns.length && refs.length + tokens.length == args.length;

      if (timed && args.length > 1) throw rule('then() takes a duration alone - this.then({ sec: 10 }).');
      if (timed) return this.delay(items as Record<string, unknown>);
      if (mapped) return this.group(Array.from(items as Iterable<unknown>, each));
      if (grouped) return this.group(args);
      if (waits) return this.wait(refs, tokens);
      if (refs.length) throw rule('then() takes steps uncalled to answer and called ones to race - not other functions.');
      if (fns.length == 2 && args.length == 2 && this._point && !this._settled) return this._point(fns[0] as any, fns[1] as any);
      if (fns.length == 1) throw rule('then() takes steps, not a function - declare the work as a step.');

      throw rule('a step cannot await its own run.');
    };

    Object.setPrototypeOf(view, this.run.control._runner);
    Object.defineProperties(view, {
      then: { value: view },
      end: { value: (...value: unknown[]) => (valueless(value), this.issue('end', [])) },
      signal: { get: () => this._abort.signal },
      retried: { get: () => this._retried },
      retry: { value: retry },
      only: { value: (max: unknown, key?: unknown) => this.slot(max, key) },
      on: { value: (handlers: unknown) => this.handle(handlers) },
      restore: {
        value: () => {
          if (!this._restore) throw rule('restore() must be called in a .catch handler.');

          this._restore(this, true);
        }
      },
      commit: {
        value: () => {
          if (this._settled) throw rule(`${this.key} has settled; commit cannot run.`);

          this._committed = true;
        }
      }
    });

    return (this._view = view as unknown as Steps.Controller);
  }

  handle(handlers: unknown) {
    const { run } = this;
    const usage = 'then.on() takes steps called for it - { reset: this.release(id) } - or a function.';

    if (this.id == run._root) throw rule('run cleans up in its tail - try/catch around await this.');
    if (this._undo) throw rule('then.on() cannot run in a handler step - use try/finally inside it.');
    if (this._settled) throw rule(`${this.key} has settled; on cannot run.`);
    if (!plain(handlers)) throw rule(usage);

    for (const [kind, value] of Object.entries(handlers as object)) {
      if (!KINDS.includes(kind as Kind)) throw rule(`then.on() takes reset, catch, abort and close - got ${kind}.`);
      if (value === undefined) continue;
      if (kind == 'catch' && this._on.some((handler) => handler.kind == 'catch')) throw rule('then.on() takes one catch per step.');

      const step = typeof value == 'function' && this.keyOf(value);
      let node: Steps.Node;

      if (step) node = run.node(step, []);
      else if (typeof value == 'function') {
        node = run.node('then', []);
        run._inline.set(node.id, value);
        run._owner.set(node.id, this);
      }
      else [node] = this.claimed(Array.isArray(value) ? value : [value], usage, 'then.on()');

      this._on.push({ kind: kind as Kind, node, bare: !!step });
    }
  }

  claimed(args: unknown[], usage: string, verb = 'then()') {
    const { _steps } = this.run.control;
    const fns = args.filter((arg) => typeof arg == 'function');
    const steps = args.every((arg) => {
      const node = arg as Steps.Node;

      return this._items.includes(node) && !UNPLANNED.includes(node.key) && (node.group || _steps.has(node.key));
    });

    if (fns.length && fns.length < args.length) throw rule(`${verb} takes called steps or step references, not both.`);
    if (!args.length || !steps) throw rule(usage);

    return this.claim([args.length > 1 ? this.group(args) : (args[0] as Steps.Node)]);
  }

  claim(nodes: Steps.Node[]) {
    this._items = this._items.filter((item) => !nodes.includes(item));

    if (this._items.length) this.arm();
    else {
      this._armed++;
      this._late = undefined;
    }

    return nodes;
  }

  rescue(token: Steps.Node, handler: unknown) {
    const key = this.keyOf(handler);

    if (UNCAUGHT.includes(token.key)) throw rule(`${named(token.key)} cannot be caught.`);
    if (handler && typeof handler != 'function') throw rule('catch() takes a step, a function or nothing.');
    if (RETRY.has(handler as Function))
      throw rule('catch() retries from a handler: .catch(this.rescan), rescan(error) { if (this.then.retried >= 3) throw error; this.then.retry(); }');

    token.rescue = handler ? key || 'then' : true;
    this.run._catches.set(token.id, { key, fn: handler as Function | undefined });

    return token;
  }

  retry() {
    const { run, _caught: caught } = this;

    if (!caught) throw rule('retry() must be called in a .catch handler.');
    if (this._settled) throw rule(`${this.key} has settled; retry cannot run.`);

    this._items.push(run.copy(caught));
    this.arm();
  }

  slot(max: unknown, key: unknown) {
    if (typeof max != 'number' && typeof max != 'function') throw rule('only() takes a count, or a function returning one.');

    const token = this.issue('gate', []);

    this.run._slots.set(token.id, { max: max as Slot['max'], key });
  }

  delay(duration: Record<string, unknown>) {
    let ms = 0;

    if (!Object.keys(duration).length) throw rule('then() takes a duration of ms, sec, min, hr and day as numbers - got none.');

    for (const [unit, value] of Object.entries(duration))
      if (!Object.hasOwn(UNITS, unit) || typeof value != 'number' || !(value >= 0))
        throw rule(`then() takes a duration of ms, sec, min, hr and day as numbers - got ${unit}.`);
      else ms += value * UNITS[unit];

    return Object.assign(this.issue('wait', [ms]), { answers: [] });
  }

  group(members: unknown[]) {
    for (const member of members as Steps.Node[])
      if (!this._items.includes(member)) throw rule(`then() takes steps called by ${this.key}.`);

    const group = Object.assign(this.run.node('then', []), { group: members as Steps.Node[] });

    ISSUED.set(group, this);
    this.run._groups.add(group.id);

    this._items = this._items.filter((item) => !members.includes(item));
    this._items.push(group);
    this.arm();

    return group;
  }

  wait(answers: string[], racers: unknown[]) {
    for (const key of answers) if (key == 'run') throw rule('run cannot answer a wait.');

    const [race] = racers.length ? this.claimed(racers, 'then() races steps called for it - this.then(this.allow, this.timeout(call)).') : [];
    const token = Object.assign(this.issue('wait', []), { answers }, race && { race });

    if (race) adopt(this.run._parent, [race], token.id);

    return token;
  }

  commit(out: unknown) {
    const { run, id, key, _items: items, _violation, _late, _wake, _lost, _on } = this;

    if (_violation) throw rule(`${key} wrote ${_violation} after scheduling ${items[0].key}.`);
    if (_late && !items.length) throw rule('run awaited work before its plan - it takes arguments, calls steps and awaits this.');
    if (_late) throw rule(`${key} kept working after scheduling ${items[0].key}.`);

    const root = id == run._root;

    if (!root && out !== undefined) throw rule(`${key} returned a value; a step returns nothing - its undo is this.then.on({ reset }).`);

    const end = items.findIndex((item) => item.key == 'end');

    if (end >= 0 && end < items.length - 1) throw rule('end must be the last call in a step.');

    adopt(run._parent, items, id);

    const entry: Steps.Entry = { ...this.journal(), next: items };

    if (_wake) entry.wake = _wake;
    if (this._retried) entry.retried = this._retried;

    if (_on.length) {
      entry.on = grouped(_on);
      run._on.set(id, _on);
    }

    if (_lost.size && !_on.some((handler) => handler.kind == 'reset')) entry.irreversible = [..._lost];

    if (!root) run._held.set(id, { prior: this._prior, log: this._log });
    if (this._undo) run._spent.add(id);

    run._entries.push(entry);
    this._entry = entry;

    return entry;
  }

  journal(): Steps.Entry {
    const { id, key, args, _wrote, _changed, _committed } = this;
    const entry: Steps.Entry = { id, key, args, next: [], wrote: [...new Set([..._wrote, ..._changed])] };

    if (_committed) entry.committed = true;

    return entry;
  }

  wrap(key: string, value: Collection) {
    let wrapper = this._wrappers.get(value);

    if (wrapper) return wrapper;

    const ops = mutators(value);

    wrapper = new Proxy(value, {
      get: (target, prop) => {
        const op = ops[prop as string];

        if (op)
          return (...args: unknown[]) => {
            const out = this.change(key, () => op(...args));

            return out === target ? wrapper : out;
          };

        const got = Reflect.get(target, prop, target);

        return typeof got == 'function' ? got.bind(target) : got;
      }
    });

    this._wrappers.set(value, wrapper);

    return wrapper;
  }

  change(key: string, op: () => Change) {
    const at = this._settled ? this.live() : this;

    if (!at) return op()[0];

    const [out, changed, undo, lost] = op();

    if (!changed) return out;
    if (at._items.length) at._violation ||= key;
    if (undo) at._log.push([key, undo]);
    if (lost) at._lost.add(key);

    at._changed.add(key);
    at.run._writer.set(key, at.id);

    return out;
  }
}

export { Frame };

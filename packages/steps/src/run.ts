import { get, has, Model } from '@expressive/mvc';
import { event, listener } from '@expressive/mvc/observable';

import { Frame } from './frame';
import { adopt, chain, type Gate, grouped, type Handler, ISSUED, type Log, type Mode, type Restore, rule, RULES, signal, type Slot, type Ticket } from './shared';
import { Control, Steps } from './steps';
import { blame, fire, recover, refill, reset, restore, rewind, unwind } from './unwind';
import { acquire, park, racing, Wait, wake } from './wait';

const MODES = { failed: 'error', aborted: 'abort', stopped: 'stop' } as const;

const TOKEN = {
  catch(this: Steps.Node, handler?: unknown) {
    const frame = ISSUED.get(this);

    if (!frame) throw rule(`catch() must be called in the step which called ${this.key}().`);

    return frame.rescue(this, handler);
  }
};

function unissue(items: Steps.Node[]) {
  for (const item of items) {
    ISSUED.delete(item);

    if (item.group) unissue(item.group);
  }
}

function serial(error: unknown) {
  if (!(error instanceof Error)) return error;

  const { name, message, cause } = error;

  return { name, message, ...cause !== undefined && { cause } };
}

interface Held {
  prior: Record<string, unknown>;
  log: Log;
}

interface Rescue {
  key?: string;
  fn?: Function;
}

interface Branch {
  failed?: { cause: unknown };
}

interface Lineage {
  restore: Restore;
  caught: Steps.Node;
}

class Run extends Model {
  control = get(Control);
  frames = new Set<Frame>();
  waits = has(Wait);

  _ticket!: Ticket;
  _entries: Steps.Entry[] = [];
  _counts = new Map<string, number>();
  _on = new Map<string, Handler[]>();
  _finished = new Set<string>();
  _reset = new Set<string>();
  _writer = new Map<string, string>();
  _lost = new Set<string>();
  _losing = new Map<string, Promise<unknown>>();
  _held = new Map<string, Held>();
  _inline = new Map<string, Function>();
  _errors = new Map<string, unknown>();
  _owner = new Map<string, Frame>();
  _parent = new Map<string, string>();
  _slots = new Map<string, Slot>();
  _catches = new Map<string, Rescue>();
  _branches = new Map<string, Branch>();
  _lineage = new Map<string, Lineage>();
  _retried = new Map<string, number>();
  _gates = new Map<string, Gate>();
  _groups = new Set<string>();
  _pending = new Map<string, () => void>();
  _holding = new Map<() => void, string>();
  _dropped = new Set<string>();
  _version = 0;
  _below = new Map<string, [number, boolean]>();
  _flight = new Set<Frame>();
  _stack: Frame[] = [];
  _spent = new Set<string>();
  _unwinding?: Promise<unknown> = undefined;
  _drained: (() => void)[] = [];
  _quiet = new Set<() => void>();
  _halted?: 'failed' | 'stopped' | 'aborted' = undefined;
  _ending?: boolean = undefined;
  _settling?: boolean = undefined;
  _error?: unknown = undefined;
  _stopped?: Error = undefined;
  _root?: string = undefined;
  _result?: unknown = undefined;
  _tail?: Promise<unknown> = undefined;
  _await?: { resolve(value?: unknown): void; reject(error: unknown): void } = undefined;

  protected new() {
    const { control } = this;

    listener(this.waits, (key) => {
      let current = signal(key) && control._current === this;

      if (!current) return;

      event(control, 'waiting');

      control.status = this.waits.size ? 'waiting' : this._halted || 'running';
    });
  }

  start() {
    const node = this.node('run', this._ticket.args);

    this._root = node.id;
    this.exec(node).then(() => {
      if (!this._halted && !this._ending) this.end();
    });
  }

  node(key: string, args: unknown[]): Steps.Node {
    const count = (this._counts.get(key) || 0) + 1;

    this._counts.set(key, count);

    return Object.assign(Object.create(TOKEN), { id: `${key}#${count}`, key, args }) as Steps.Node;
  }

  flight() {
    return [...this._flight];
  }

  stale() {
    return !!(this._halted || this._ending);
  }

  dropped(id: string) {
    return this._dropped.has(id) || this.below(id);
  }

  below(id: string) {
    const { _dropped: dropped, _below: memo, _version: version } = this;
    const path: string[] = [];
    let result = false;

    for (let at = id; ; ) {
      const known = memo.get(at);

      if (known && known[0] == version) {
        result = known[1];
        break;
      }

      const parent = this._parent.get(at);

      path.push(at);

      if (!parent) break;

      if (dropped.has(parent) || dropped.has(parent + '^')) {
        result = true;
        break;
      }

      at = parent;
    }

    for (const at of path) memo.set(at, [version, result]);

    return result;
  }

  line(id: string) {
    const ids: string[] = [];

    for (let at: string | undefined = id; at; at = this._parent.get(at)) ids.push(at);

    return ids;
  }

  async exec(item: Steps.Node, from?: Frame): Promise<void> {
    if (this.stale() || this.dropped(item.id)) return;

    const rescue = this._catches.get(item.id);

    if (rescue && !this._branches.has(item.id)) return this.guard(item, from!, rescue);

    if (item.group) {
      await Promise.all(item.group.map((member) => this.exec(member, from)));
      return;
    }

    if (item.answers) {
      const answer = await park(this, item, from!);

      if (answer) {
        const frame = await answer.frame;

        await this.cover(frame);
        await this.complete(frame);
        answer.done();
      }
    }
    else if (item.key == 'end') await this.terminate(item);
    else {
      const wait = racing(this, item);

      if (wait) return void wake(this, wait, item.key, item.args, item);

      const frame = await this.invoke(item);

      if (!frame || !this._on.has(frame.id)) return this.descend(frame);

      await this.cover(frame, item);
      await this.complete(frame);
    }
  }

  async cover(frame?: Frame, item?: Steps.Node) {
    const handler = frame && this._on.get(frame.id)?.find(({ kind }) => kind == 'catch');

    if (!handler) return this.descend(frame);

    const { id, key, args, _failed: failed } = frame!;
    const shield = id + '^';
    const branch: Branch = { failed };

    item ||= Object.assign(Object.create(TOKEN), { id, key, args });

    if (!failed) {
      this._branches.set(shield, branch);
      await this.descend(frame);
      this._branches.delete(shield);
    }

    if (!branch.failed) return;

    const { cause } = branch.failed;
    const restore = await this.serial(() => (failed ? rewind(this, id, cause) : recover(this, item!, cause, 'error', false)));

    this._dropped.delete(shield);
    this._version++;

    if (this.stale()) return restore();

    const node = this.given(handler, cause);

    this._parent.set(node.id, id);
    this._lineage.set(node.id, { restore, caught: item! });
    this._retried.set(node.id, this.retried(item!));

    await this.exec(node, frame);
    restore();
  }

  async complete(frame?: Frame) {
    const on = frame && this._on.get(frame.id);

    if (!on) return;

    const { id } = frame!;
    const losing = [...this._losing].filter(([racer]) => this.line(racer).includes(id));

    await Promise.all(losing.map(([, unwind]) => unwind));

    if (this.stale() || this.dropped(id)) return;

    this._finished.add(id);

    try {
      await fire(this, on, 'close', undefined, new Set());
    } catch (error) {
      if (!this.caught(error, id)) this.halt('failed', error);
    }
  }

  given({ node, bare, kind }: Handler, cause: unknown) {
    if (bare && (kind == 'catch' || (kind == 'abort' && cause !== undefined))) {
      node.args = [serial(cause)];
      this._errors.set(node.id, cause);
    }
    else if (kind == 'catch' && this._inline.has(node.id)) node.args = [cause];

    return node;
  }

  terminate(item: Steps.Node) {
    this.release();

    return this.end(item);
  }

  serial<T>(task: () => Promise<T>) {
    const prior = this._unwinding;
    const next = (async () => {
      await prior;
      return task();
    })();

    this._unwinding = next;

    return next;
  }

  async guard(item: Steps.Node, from: Frame, rescue: Rescue) {
    const branch: Branch = {};

    this._branches.set(item.id, branch);

    await this.exec(item, from);

    this._branches.delete(item.id);

    if (!branch.failed) return;

    const { cause } = branch.failed;
    const restore = await this.serial(() => recover(this, item, cause, 'error'));
    const { key, fn } = rescue;
    const parent = this._parent.get(item.id)!;

    if (this.stale() || !fn) return restore();

    const node = this.node(key || 'then', key ? [serial(cause)] : [cause]);

    if (key) this._errors.set(node.id, cause);

    this._parent.set(node.id, parent);
    this._lineage.set(node.id, { restore, caught: item });
    this._retried.set(node.id, this.retried(item));

    if (!key) {
      this._inline.set(node.id, fn!);
      this._owner.set(node.id, from);
    }

    await this.exec(node, from);
    restore();
  }

  retried(item: Steps.Node) {
    return this._retried.get(item.id) || 0;
  }

  copy(item: Steps.Node, retried = this.retried(item) + 1): Steps.Node {
    const { id, key, args, group, answers, race } = item;
    const node = this.node(key, args);
    const rescue = this._catches.get(id);

    this._retried.set(node.id, retried);

    if (group) {
      node.group = group.map((member) => this.copy(member, retried));
      this._groups.add(node.id);
      adopt(this._parent, node.group, node.id);
    }

    if (answers) node.answers = answers;

    if (race) {
      node.race = this.copy(race, retried);
      adopt(this._parent, [node.race], node.id);
    }

    if (rescue) {
      node.rescue = item.rescue;
      this._catches.set(node.id, rescue);
    }

    return node;
  }

  caught(error: unknown, id: string) {
    if (this.stale() || RULES.has(error as Error)) return false;

    let at: string | undefined;

    for (const each of this.line(id))
      if (each != id && this._branches.has((at = each + '^'))) break;
      else if (this._branches.has((at = each))) break;
      else at = undefined;

    if (!at) return false;

    const branch = this._branches.get(at)!;

    if (branch.failed) return true;

    branch.failed = { cause: error };
    this._dropped.add(at);
    this._version++;

    for (const frame of this.discard()) frame._abort.abort();

    return true;
  }

  discard() {
    for (const wait of this.waits.filter((wait) => this.dropped(wait.id))) this.waits.delete(wait);
    for (const [id, cancel] of this._pending) if (this.dropped(id)) cancel();

    return this.flight().filter((frame) => this.dropped(frame.id));
  }

  async descend(frame?: Frame) {
    if (frame) return this.sequence(frame._items, frame);
  }

  async sequence(items: Steps.Node[], from: Frame): Promise<void> {
    for (const [index, item] of items.entries()) {
      if (item.key != 'gate') {
        if (index == items.length - 1) return this.exec(item, from);

        await this.exec(item, from);
        continue;
      }

      const release = await acquire(this, item, from);

      if (!release) return;

      try {
        await this.sequence(items.slice(index + 1), from);
      } finally {
        release();
      }

      return;
    }
  }

  release() {
    this.waits.clear();

    for (const cancel of this._pending.values()) cancel();
    for (const release of this._holding.keys()) release();
  }

  async invoke(node: Steps.Node, wake?: string, undo?: boolean): Promise<Frame | undefined> {
    const { control } = this;
    const { id, key, args } = node;
    const inline = this._inline.get(id);
    const lineage = this._lineage.get(id);
    const fn = inline || control._steps.get(key)!;
    const frame = new Frame(this, { id, key, args, _wake: wake, _undo: undo, _owner: this._owner.get(id), _retried: this.retried(node), ...lineage && { _restore: lineage.restore, _caught: lineage.caught } });

    this.frames.add(frame);

    if (!undo) this._stack.push(frame), this._flight.add(frame);

    const input = this._errors.has(id) ? [this._errors.get(id)] : args;
    let body = false;

    control.active = key;

    try {
      control.hook('before', key, args);

      if (!fn) throw rule(key == 'run' ? `${control._self} declares no run - add async run() to start a run.` : `${key} was removed by a hot update.`);

      for (;;)
        try {
          const call = inline ? fn(...input) : fn.apply(frame._proxy, input);
          const out = id == this._root ? await frame.open(call) : await call;

          frame._settled = true;

          const entry = frame.commit(out);

          frame._restore?.(frame);
          control.hook('after', key, entry);

          return frame;
        } catch (thrown) {
          if (frame._entry) throw thrown;

          let error = thrown;
          let irreversible = [...frame._lost];
          let fixed = irreversible.length || frame._committed;

          body = !frame._settled;

          if (error instanceof Promise && body && !fixed) {
            await fire(this, frame._on, 'reset', undefined, new Set());

            reset(this, frame);

            const failed = await frame.pause(error);

            if (!failed) continue;

            error = failed.cause;
          }

          if (fixed) this._entries.push((frame._fixed = { ...frame.journal(), error, ...irreversible.length && { irreversible } }));

          throw error;
        }
    } catch (error) {
      if (frame._entry && !undo) {
        frame._restore?.();
        return void this.halt('failed', error);
      }

      const { signal } = frame._abort;
      const fixed = frame._lost.size || frame._committed;
      const lost = this.line(id).some((at) => this._lost.has(at));
      const aborted = signal.aborted && error === signal.reason;
      const on = !fixed && !undo && frame._on.length ? frame._on : undefined;
      const defer = on && !aborted && !this.stale();
      const entry: Steps.Entry = { id, key, args, next: [], wrote: [], error, ...wake && { wake }, ...frame._retried && { retried: frame._retried } };

      frame._settled = true;

      if (!fixed && !defer) restore(this, frame._prior, frame._log);

      frame._restore?.();

      if (undo) throw error;

      if (on) {
        entry.on = grouped(on);
        this._on.set(id, on);
        this._entries.push(entry);
      }

      if (defer) this._held.set(id, { prior: frame._prior, log: frame._log });
      if (aborted) return;

      let own = body && !fixed && !lost && !this.stale() && !RULES.has(error as Error) && !!on?.some(({ kind }) => kind == 'catch');

      if (own) {
        frame._failed = { cause: error };

        try {
          control.hook('after', key, entry);
        } catch (thrown) {
          this.halt('failed', thrown);
        }

        return frame;
      }

      if (body && !fixed && (lost || this.caught(error, id))) {
        if (!on) this._entries.push(entry);

        try {
          control.hook('after', key, entry);
        } catch (thrown) {
          this.halt('failed', thrown);
        }
      } else this.fault(frame._fixed || entry, !on && !frame._fixed, error);
    } finally {
      const { _stack: stack, _flight: flight } = this;

      this.frames.delete(frame);
      frame._abort.abort();
      flight.delete(frame);
      unissue(frame._items);

      while (stack.length && !flight.has(stack.at(-1)!)) stack.pop();

      if (stack.length > flight.size * 2) this._stack = stack.filter((each) => flight.has(each));

      control.active = stack.at(-1)?.key;

      for (const check of [...this._quiet]) check();

      if (!flight.size) for (const resolve of this._drained.splice(0)) resolve();
    }
  }

  fault(entry: Steps.Entry, push: boolean, error: unknown) {
    if (push) this._entries.push(entry);

    try {
      this.control.hook('after', entry.key, entry);
    } catch (thrown) {
      error = thrown;
    }

    this.halt('failed', error);
  }

  async end(item?: Steps.Node) {
    this._ending = true;

    await this.drain();

    if (this._unwinding) await this._unwinding;
    if (this._halted) return;

    const open = this._entries.filter((entry) => this._on.has(entry.id) && !this._finished.has(entry.id) && !this._spent.has(entry.id));

    for (const entry of open.reverse())
      try {
        this._finished.add(entry.id);
        await fire(this, this._on.get(entry.id), 'close', undefined, new Set());
      } catch (thrown) {
        return this.halt('failed', thrown);
      }

    const { id } = item || this.node('end', []);
    const entry = { id, key: 'end', args: [], next: [], wrote: [], ...!item && { implicit: true as const } };

    this._entries.push(entry);

    if (item)
      try {
        this.control.hook('after', 'end', entry);
      } catch (thrown) {
        return this.halt('failed', thrown);
      }

    this.finish();
  }

  drain() {
    if (this._flight.size) return new Promise<void>((resolve) => this._drained.push(resolve));
  }

  finish() {
    const { _tail: tail } = this;

    this._settling = true;

    if (!tail) return this.settle(this._result);

    this._await!.resolve();
    tail.then((value) => this.settle(value), (error) => this.broke(error));
  }

  broke(error: unknown) {
    blame(this, error);
    this.control.status = 'failed';
    this.reject();
  }

  settle(value: unknown) {
    const { control } = this;

    this.close();
    control.status = 'idle';
    this._ticket.resolve(value);
    control.advance();
  }

  close() {
    const { control } = this;

    control._current = undefined;
    control.runs++;
    this._entries = [];
    this._held.clear();
    this._on.clear();
    this._parent.clear();
    this._below.clear();
    this._catches.clear();
    this._groups.clear();
    this.frames.clear();
    this._flight.clear();
    this._stack = [];
    this.waits.clear();
  }

  halt(status: 'failed' | 'stopped' | 'aborted', error?: unknown) {
    const { control } = this;

    if (this._halted || this._settling) return;

    this._halted = status;
    control.status = status;

    for (const frame of this.flight()) frame._abort.abort(status == 'failed' ? undefined : this._stopped);

    if (status == 'failed') {
      this._error = error;
      control.error = error;
    }

    this.release();
    this.finalize(MODES[status]);
  }

  async finalize(mode: Mode) {
    await this.drain();

    if (this._unwinding) await this._unwinding;

    const unwound = await unwind(this, this.reason(), mode);

    refill(this, unwound);

    if (unwound.failed) {
      const { cause } = unwound.failed;

      if (mode != 'error') {
        chain(cause, this._stopped);
        this.control.status = 'failed';
      }

      blame(this, cause);
    }

    const { _tail: tail } = this;

    if (!tail) return this.reject();

    this._await!.reject(this.reason());

    try {
      this.salvage(await tail);
    } catch (thrown) {
      this.reject(thrown);
    }
  }

  salvage(value: unknown) {
    this.close();
    this._ticket.resolve(value);
    this.control.advance();
  }

  reason() {
    const { _error: error } = this;

    return error === undefined ? this._stopped : error;
  }

  reject(reason = this.reason()) {
    const { _ticket } = this;
    let stopped = reason === this._stopped;

    this.close();
    _ticket.reject(reason);

    if (!stopped)
      queueMicrotask(() => queueMicrotask(() => {
        if (!_ticket.awaited) throw reason;
      }));

    this.control.advance();
  }

}

export { Run };

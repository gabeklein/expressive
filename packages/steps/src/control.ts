import { has, Model } from '@expressive/mvc';
import { event, listener } from '@expressive/mvc/observable';

import { Run } from './run';
import { Aborted, Steps, Stopped } from './steps';
import type { Gate, Ticket } from './types';
import { handle, rule, signal } from './util';
import { accepts, route, wake } from './wait';

class Control extends Model {
  status: Steps.Status = 'idle';
  active: string | undefined = undefined;
  runs = 0;
  error: unknown = undefined;
  queue = has<Ticket>();
  run = new Run();

  _self!: Model;
  _runner!: object;
  _steps = new Map<string, Function>();
  _hooks = new Map<string, Function>();
  _gates = new Map<unknown, Gate>();
  _current?: Run = undefined;

  protected new() {
    const { _runner } = this;

    listener(this.queue, (key) => {
      if (signal(key)) event(this, 'queue');
    });

    return this.set((key) => void event(_runner, key as string));
  }

  call(key: string, args: unknown[]) {
    if (key == 'run') return this.start(args);

    const { _current: current } = this;
    const wait = current && route(current, key, args);

    if (wait) return wake(current!, wait, key, args);

    throw rule(`${key} cannot be called from outside; call run() to start a run.`);
  }

  accepts(key: string) {
    return !!this._current && accepts(this._current, key);
  }

  hook(key: string, ...args: unknown[]) {
    return this._hooks.get(key)?.apply(this._self, args);
  }

  start(args: unknown[]) {
    const ticket = { args } as Ticket;

    ticket.promise = new Promise((resolve, reject) => {
      ticket.resolve = resolve;
      ticket.reject = reject;
    });

    ticket.promise.catch(() => {});

    if (this._current) this.queue.push(ticket);
    else this.begin(ticket);

    return handle(ticket, (resolve, reject) => ticket.promise.then(resolve, reject));
  }

  begin(ticket: Ticket) {
    const run = new Run({ _ticket: ticket });

    this._current = this.run = run;
    this.error = undefined;
    this.status = 'running';

    run.start();
  }

  advance() {
    const next = this.queue.pop(0);

    if (next) this.begin(next);
  }

  tail() {
    return this.queue.get(-1) || this.run._ticket;
  }

  settled() {
    if (!this._current) {
      if (this._steps.get('run')?.length)
        return Promise.reject(new Error(`${this._self} is idle. run() takes arguments; call it to start a run.`));

      this.start([]);
    }

    return this.join();
  }

  join(): Promise<unknown> {
    const ticket = this.tail()!;
    const tickets = [this._current?._ticket, ...this.queue, ticket].filter(Boolean) as Ticket[];

    for (const each of tickets) each.awaited = true;

    return ticket.promise.then(
      (value) => (this.tail() === ticket ? value : this.join()),
      (error) => (this.tail() === ticket ? Promise.reject(error) : this.join())
    );
  }

  conclude() {
    const { _current: run } = this;

    if (run && !run.stale()) run.terminate(run.node('end', []));
  }

  stop(undo?: boolean, reason?: unknown) {
    const { _current: current, queue } = this;

    if (!current) return;

    const message = typeof reason == 'string' ? reason : `${this._self} was ${undo ? 'aborted' : 'stopped'}.`;
    const stopped = new (undo ? Aborted : Stopped)(message, reason === undefined ? undefined : { cause: reason });

    for (const ticket of queue) ticket.reject(stopped);

    queue.clear();

    current._stopped = stopped;
    current.release();
    current.halt(undo ? 'aborted' : 'stopped');
  }
}

export { Control };

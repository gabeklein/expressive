import { Frame } from './frame';
import { Steps } from './steps';
import type { Handler, Kind, Ticket } from './types';

const HOOKS = new Set(['before', 'after']);

const KEYS = ['status', 'active', 'queue', 'waiting', 'runs', 'error'] as const;

const SLACK = 8;

const LONGEST = 2 ** 31 - 1;

const UNCAUGHT = ['gate', 'end'];

const UNPLANNED = ['end', 'gate', 'wait'];

const RESERVED = ['then', 'end', 'gate', 'wait'];

const REFRESH = Symbol.for('@expressive/mvc.refresh');

const ISSUED = new WeakMap<object, Frame>();

const RETRY = new WeakSet<Function>();

const RULES = new WeakSet<Error>();

const KINDS: Kind[] = ['reset', 'catch', 'abort', 'close'];

const MODES = { failed: 'error', aborted: 'abort', stopped: 'stop' } as const;

const UNITS: Record<string, number> = { ms: 1, sec: 1e3, min: 6e4, hr: 36e5, day: 864e5 };

const TOKEN = {
  catch(this: Steps.Node, handler?: unknown) {
    return ISSUED.get(this)!.rescue(this, handler);
  }
};

function chain(error: unknown, cause: unknown) {
  if (error instanceof Error && error.cause === undefined) error.cause = cause;
}

function grouped(on: Handler[]) {
  const out: NonNullable<Steps.Entry['on']> = {};

  for (const { kind, node } of on) (out[kind] ||= []).push(node);

  return out;
}

function serial(error: unknown) {
  if (!(error instanceof Error)) return error;

  const { name, message, cause } = error;

  return { name, message, ...cause !== undefined && { cause } };
}

function rule(message: string) {
  const error = new Error(message);

  RULES.add(error);

  return error;
}

function named(key: string) {
  return key == 'gate' ? 'a gate' : `${key}()`;
}

function plain(value: unknown) {
  if (!value || typeof value != 'object') return false;

  const proto = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
}

function signal(key: unknown) {
  return typeof key != 'boolean' && key !== null;
}

function iterable(value: unknown): value is Iterable<unknown> {
  return value != null && typeof (value as Iterable<unknown>)[Symbol.iterator] == 'function';
}

function valueless(args: unknown[]) {
  if (args.length) throw rule('end() takes no value; the result is what run returns.');
}

function outside(key: string, verb = 'called'): never {
  throw rule(`${key} must be ${verb} inside a step.`);
}

class Handled<T> extends Promise<T> {
  static get [Symbol.species]() {
    return Promise;
  }

  declare _ticket: Ticket;

  then<A = T, B = never>(...args: Parameters<Promise<T>['then']>): Promise<A | B> {
    this._ticket.awaited = true;
    return super.then(...args) as Promise<A | B>;
  }
}

function handle<T>(ticket: Ticket, executor: ConstructorParameters<typeof Promise<T>>[0]) {
  const handled = new Handled<T>(executor);

  handled._ticket = ticket;
  Promise.prototype.then.call(handled, undefined, () => {});

  return handled;
}

function adopt(parents: Map<string, string>, items: Steps.Node[], parent: string) {
  for (const item of items) {
    parents.set(item.id, parent);

    if (item.group) adopt(parents, item.group, item.id);
  }
}

export { HOOKS, ISSUED, KEYS, KINDS, LONGEST, MODES, REFRESH, RESERVED, RETRY, RULES, SLACK, TOKEN, UNCAUGHT, UNITS, UNPLANNED, adopt, chain, grouped, handle, iterable, named, outside, plain, rule, serial, signal, valueless };

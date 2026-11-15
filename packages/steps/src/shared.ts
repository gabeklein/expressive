import { Frame } from './frame';
import { Run } from './run';
import { Steps } from './steps';

type Log = [key: string, undo: () => void][];

interface Ticket {
  args: unknown[];
  promise: Promise<unknown>;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  awaited?: boolean;
}

type Kind = 'reset' | 'catch' | 'abort' | 'close';

type Mode = 'error' | 'abort' | 'stop';

interface Handler {
  kind: Kind;
  node: Steps.Node;
  bare?: boolean;
}

type Restore = (into?: Frame, all?: boolean, within?: string) => void;

interface Gate {
  held: Set<Hold>;
  queue: Waiter[];
}

interface Hold {
  run: Run;
  from: string;
}

interface Slot {
  max: number | ((...args: any[]) => number);
  key: unknown;
}

interface Waiter {
  hold: Hold;
  max(): number;
  grant(): void;
}

const ISSUED = new WeakMap<object, Frame>();

const RULES = new WeakSet<Error>();

function chain(error: unknown, cause: unknown) {
  if (error instanceof Error && error.cause === undefined) error.cause = cause;
}

function grouped(on: Handler[]) {
  const out: NonNullable<Steps.Entry['on']> = {};

  for (const { kind, node } of on) (out[kind] ||= []).push(node);

  return out;
}

function rule(message: string) {
  const error = new Error(message);

  RULES.add(error);

  return error;
}

function plain(value: unknown) {
  if (!value || typeof value != 'object') return false;

  const proto = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
}

function signal(key: unknown) {
  return typeof key != 'boolean' && key !== null;
}

function valueless(args: unknown[]) {
  if (args.length) throw rule('end() takes no value; the result is what run returns.');
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

export { ISSUED, RULES, adopt, chain, grouped, handle, plain, rule, signal, valueless };
export type { Gate, Handler, Hold, Kind, Log, Mode, Restore, Slot, Ticket, Waiter };

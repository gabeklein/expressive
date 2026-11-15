import { has, map } from '@expressive/mvc';

import { Frame } from './frame';
import { Run } from './run';
import { Steps } from './steps';

type Collection = has.List<unknown> | has.Pool<unknown> | map.Managed<unknown, unknown>;

type Change = [out: unknown, changed: boolean, undo?: () => void, lost?: boolean];

type Mutator = (...args: any[]) => Change;

type Log = [key: string, undo: () => void][];

interface Held {
  prior: Record<string, unknown>;
  log: Log;
}

interface Ticket {
  args: unknown[];
  promise: Promise<unknown>;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  awaited?: boolean;
}

interface Answer {
  frame: Promise<Frame | undefined>;
  done(): void;
  fail(error: unknown): void;
}

type Kind = 'reset' | 'catch' | 'abort' | 'close';

type Mode = 'error' | 'abort' | 'stop';

interface Handler {
  kind: Kind;
  node: Steps.Node;
  bare?: boolean;
}

interface Rescue {
  key?: string;
  fn?: Function;
}

type Restore = (into?: Frame, all?: boolean, within?: string) => void;

interface Unwound {
  undone: Steps.Entry[];
  kept: Set<string>;
  failed?: { cause: unknown };
}

interface Branch {
  failed?: { cause: unknown };
}

interface Lineage {
  restore: Restore;
  caught: Steps.Node;
}

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

export type { Answer, Branch, Change, Collection, Gate, Handler, Held, Hold, Kind, Lineage, Log, Mode, Mutator, Rescue, Restore, Slot, Ticket, Unwound, Waiter };

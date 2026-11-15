import '../mvc/test.setup';

import { expect } from 'vitest';

import { Steps } from './src/steps';
import { flushMicrotasks } from '../mvc/test.setup';

export { flushMicrotasks, mockPromise, mockUncaught, mockWarn } from '../mvc/test.setup';

const RUNS = new WeakMap<object, Steps.Entry[][]>();

/**
 * Extend a Steps class to keep every entry its `after` hook is handed, per run - read with
 * `record(instance)`. Its own hooks still run; a subclass overriding one calls `super`.
 */
export function journal<T extends new (...args: any[]) => Steps>(Base: T): T {
  class Journaled extends (Base as new (...args: any[]) => Steps) {
    protected before(step: string, args: unknown[]) {
      current(this);
      super.before?.(step, args);
    }

    protected after(step: string, entry: Steps.Entry) {
      current(this).push(entry);
      super.after?.(step, entry);
    }
  }

  Object.defineProperty(Journaled, 'name', { value: Base.name });

  return Journaled as unknown as T;
}

function current(instance: Steps) {
  const runs = RUNS.get(instance) || [];
  const index = instance.then.runs;

  RUNS.set(instance, runs);

  return (runs[index] ||= []);
}

/** A Steps base keeping the entries `after` is handed. */
export const Journal = journal(Steps);

/** Entries `after` was handed in the instance's current or last run - or in run `index`. */
export function record(instance: Steps, index = -1): Steps.Entry[] {
  return RUNS.get(instance)?.at(index) || [];
}

type Runnable<T extends Steps> = new (...args: any[]) => T;
type Entry<T> = T extends { run(...args: infer A): Promise<unknown> } ? A : never[];
type Result<T> = T extends { run(...args: any[]): infer R } ? R : never;

/** Create an instance and start its run, then flush microtasks - the run's Promise is returned beside it. */
export async function start<T extends Steps>(Type: Runnable<T>, ...args: Entry<T>) {
  const test = (Type as unknown as typeof Steps).new() as T;
  const result = test.run!(...args) as Result<T>;

  await flushMicrotasks();

  return [test, result] as const;
}

/** Create an instance and await one run to its end - a tuple, as the instance is thenable. */
export async function ran<T extends Steps>(Type: Runnable<T>, ...args: Entry<T>) {
  const test = (Type as unknown as typeof Steps).new() as T;

  await test.run!(...args);

  return [test] as const;
}

/** Create an instance and assert its run rejects as `error` would match in `toThrow` - a tuple, as the instance is thenable. */
export async function fails<T extends Steps>(Type: Runnable<T>, error?: string | RegExp | (new (...args: any[]) => Error)) {
  const test = (Type as unknown as typeof Steps).new() as T;

  await expect(test.run!()).rejects.toThrow(error);

  return [test] as const;
}

/** Ids of the entries in the instance's current or last run - or in run `index`. */
export function ids(instance: Steps, index = -1) {
  return record(instance, index).map((entry) => entry.id);
}

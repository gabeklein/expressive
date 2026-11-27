import { pending } from '@expressive/mvc';

interface Schedulable {
  queued?: 'urgent' | 'passive' | 'deferred' | 'held';
  held?: number;
  holding?: Set<Schedulable>;
  holds?: (() => void)[];
  probed?: { output: unknown };
  blocking?: (() => void)[];
  update(passive: boolean): PromiseLike<unknown> | void;
  probe?(): PromiseLike<unknown> | void;
  empty?(): boolean;
  enclosed?(into: Set<Schedulable>): void;
}

const urgent = new Set<Schedulable>();
const passive = new Set<Schedulable>();
const after: (() => void)[] = [];

let depth = 0;
let urgentQueued = false;
let passiveQueued = false;

function flush(scopes: Set<Schedulable>) {
  for (const scope of scopes) {
    scopes.delete(scope);
    scope.queued = undefined;

    if (parked(scope)) continue;

    let waiting: PromiseLike<unknown> | void = undefined;

    try {
      waiting = scope.update(false);
    } catch (error) {
      console.error(error);
    }

    settle(scope);
    if (!waiting) unblock(scope);
  }
}

function flushUrgent() {
  urgentQueued = false;
  flush(urgent);

  for (const run of after.splice(0)) run();
}

/**
 * Run `run` after the next urgent flush, scheduling one if none is due.
 *
 * Passive and deferred updates may still be pending. dom uses it to restore a controlled input after an event.
 */
function afterFlush(run: () => void) {
  after.push(run);

  if (!urgentQueued) {
    urgentQueued = true;
    queueMicrotask(flushUrgent);
  }
}

function flushPassive() {
  passiveQueued = false;

  const queued = [...passive].filter((scope) => scope.queued === 'passive');
  const batch: Schedulable[] = [];

  passive.clear();

  for (const scope of queued) {
    if (parked(scope)) continue;
    batch.push(scope);
  }

  for (const scope of batch) {
    const waiting = scope.probe?.();
    if (waiting) return defer(batch, waiting, scope);
  }

  const inside = new Set<Schedulable>();

  for (const scope of batch)
    if (!scope.probed || blank(scope.probed.output)) scope.enclosed?.(inside);

  const rank = new Map(batch.map((scope) => [scope, inside.has(scope) ? 2 : scope.empty?.() ? 0 : 1]));

  batch.sort((a, b) => rank.get(a)! - rank.get(b)!);

  for (let index = 0; index < batch.length; index++) {
    const scope = batch[index];

    if (scope.queued !== 'passive' || parked(scope)) continue;

    scope.queued = undefined;

    let waiting: PromiseLike<unknown> | void = undefined;

    try {
      waiting = scope.update(true);
    } catch (error) {
      console.error(error);
    }

    settle(scope);

    if (waiting) return defer(batch.slice(index + 1), waiting, scope);
    unblock(scope);
  }
}

function parked(scope: Schedulable) {
  if (!scope.held) return false;

  scope.queued = 'held';
  settle(scope);
  unblock(scope);
  return true;
}

function seal(scope: Schedulable, inside: Set<Schedulable>) {
  const holding = scope.holding ||= new Set();

  for (const inner of inside)
    if (!holding.has(inner)) {
      inner.held = (inner.held || 0) + 1;
      holding.add(inner);
    }
}

function unseal(scope: Schedulable) {
  const { holding } = scope;

  scope.holding = undefined;

  holding?.forEach((inner) => {
    if (--inner.held!) return;

    inner.held = undefined;

    if (inner.queued === 'held') {
      inner.queued = undefined;
      schedule(inner);
    }
  });
}

function blank(output: unknown) {
  return output == null || typeof output == 'boolean';
}

function defer(scopes: Schedulable[], waiting: PromiseLike<unknown>, source: Schedulable) {
  const held = scopes.filter((scope) => scope.queued === 'passive');

  for (const scope of held) {
    scope.queued = 'deferred';
    scope.probed = undefined;
  }

  const resume = () => {
    for (const scope of held)
      if (scope.queued === 'deferred') {
        scope.queued = undefined;
        transition(() => schedule(scope));
      }
  };

  (source.blocking ||= []).push(resume);
  waiting.then(resume, resume);
}

function unblock(scope: Schedulable) {
  const { blocking } = scope;

  scope.blocking = undefined;
  blocking?.forEach((resume) => resume());
}

function release(holds?: (() => void)[]) {
  holds?.forEach((held) => held());
}

function settle(scope: Schedulable) {
  const { holds } = scope;

  scope.holds = undefined;
  release(holds);
}

function schedule(scope: Schedulable) {
  const held = pending();

  if (held) (scope.holds ||= []).push(held);
  scope.probed = undefined;

  if (!depth) {
    passive.delete(scope);
    scope.queued = 'urgent';
    urgent.add(scope);

    if (!urgentQueued) {
      urgentQueued = true;
      queueMicrotask(flushUrgent);
    }

    return;
  }

  if (scope.queued && scope.queued !== 'deferred' && scope.queued !== 'held') return;

  scope.queued = 'passive';
  passive.add(scope);

  if (!passiveQueued) {
    passiveQueued = true;
    setTimeout(flushPassive);
  }
}

function transition(work: () => void) {
  depth++;

  try {
    work();
  } finally {
    depth--;
  }
}

function claim(scope: Schedulable) {
  urgent.delete(scope);
  passive.delete(scope);
  scope.queued = undefined;
  scope.probed = undefined;
}

function unschedule(scope: Schedulable) {
  urgent.delete(scope);
  passive.delete(scope);
  scope.queued = undefined;
  scope.probed = undefined;
  settle(scope);
  unblock(scope);
}

export { afterFlush, claim, release, schedule, seal, settle, transition, unseal, unschedule };
export type { Schedulable };

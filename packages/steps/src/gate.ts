import type { Gate, Hold, Waiter } from './types';
import { Run } from './run';
import { Steps } from './steps';
import { Frame } from './frame';
import { watch, listener } from '@expressive/mvc/observable';
import { signal } from './util';

const GATES = new WeakMap<object, Gate>();

function gate<K>(gates: { get(key: K): Gate | undefined; set(key: K, gate: Gate): unknown }, key: K) {
  let gate = gates.get(key);

  if (!gate) gates.set(key, (gate = { held: new Set(), queue: [] }));

  return gate;
}

function pump(gate: Gate) {
  for (let next = gate.queue[0]; next && gate.held.size < next.max(); next = gate.queue[0]) {
    gate.queue.shift();
    gate.held.add(next.hold);
    next.grant();
  }
}

function acquire(run: Run, item: Steps.Node, from: Frame) {
  if (run.stale() || run.dropped(item.id)) return;

  const { id } = item;
  const { max, key } = run._slots.get(id)!;
  const gate = gateFor(run, from, key);
  const line = run.line(from.id);
  const hold: Hold = { run: run, from: from.id };
  const inside = [...gate.held].some((each) => each.run === run && line.includes(each.from));
  const self = run.control._self;

  return new Promise<(() => void) | undefined>((resolve) => {
    let quiet: (() => void) | undefined;
    let limit = 0;
    let over = false;

    const finish = (release?: () => void) => {
      over = true;
      quiet?.();
      run._pending.delete(id);
      resolve(release);
    };

    const release = () => {
      if (!gate.held.delete(hold)) return;

      run._holding.delete(release);
      pump(gate);
    };

    const waiter: Waiter = {
      hold,
      max: typeof max != 'function' ? () => max : max.length ? () => limit : (max as () => number),
      grant: () => {
        run._holding.set(release, from.id);
        finish(release);
      }
    };

    if (inside) return finish(() => {});

    run._pending.set(id, () => {
      gate.queue = gate.queue.filter((each) => each !== waiter);
      finish();
    });

    if (typeof max == 'function')
      quiet = max.length
        ? watch(self, ($) => {
            limit = max($);
            pump(gate);

            return over ? null : undefined;
          })
        : listener(self, (key) => void (signal(key) && pump(gate)));

    gate.queue.push(waiter);
    pump(gate);
  });
}

function gateFor(run: Run, from: Frame, key: unknown) {
  const { control } = run;

  if (key instanceof Object) return gate(GATES, key);
  if (key !== undefined) return gate(control._gates, key);

  const group = run.line(from.id).find((id) => run._groups.has(id));

  return group ? gate(run._gates, group) : gate(control._gates, control);
}

export { GATES, acquire, gate, gateFor, pump };

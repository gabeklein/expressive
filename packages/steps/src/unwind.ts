import { Frame } from './frame';
import { Run } from './run';
import { chain, type Handler, type Kind, type Log, type Mode, type Restore } from './shared';
import { Steps } from './steps';

interface Unwound {
  undone: Steps.Entry[];
  kept: Set<string>;
  failed?: { cause: unknown };
}

async function fire(run: Run, on: Handler[] | undefined, kind: Kind, cause: unknown, kept: Set<string>) {
  for (const handler of [...(on || [])].reverse())
    if (handler.kind == kind) await compensate(run, run.given(handler, cause), cause, kept, kind == 'reset' || kind == 'close' || cause === undefined);
}

async function rewind(run: Run, id: string, cause: unknown): Promise<Restore> {
  const entry = run._entries.find((each) => each.id == id)!;
  const { prior, log } = run._held.get(id)!;
  const kept = new Set<string>();

  run._reset.add(id);
  run._held.delete(id);

  try {
    await fire(run, run._on.get(id), 'reset', undefined, kept);
    entry.unwound = true;
  } catch (thrown) {
    entry.unwound = 'failed';
    run.halt('failed', thrown);
  }

  const self = run.control._self as any;
  let done = false;

  return (into, all) => {
    if (done) return;

    done = true;

    for (const key in prior) {
      const wrote = into?._wrote.has(key);

      if (wrote) into!._prior[key] = prior[key];
      if (all || (!wrote && !kept.has(key))) self[key] = prior[key];
    }

    for (const [key, undo] of [...log].reverse()) if (all || !into?._changed.has(key)) undo();
  };
}

async function recover(run: Run, item: Steps.Node, cause: unknown, mode: Mode, own = true): Promise<Restore> {
  const ids = run._entries.filter((entry) => !run._spent.has(entry.id) && (own || entry.id != item.id) && run.line(entry.id).includes(item.id));
  const unwound = await unwind(run, cause, mode, new Set(ids.map((entry) => entry.id)));
  let done = false;

  const restore: Restore = (into, all, within) => {
    if (done) return;

    done = true;
    refill(run, unwound, into, all, within);
  };

  if (unwound.failed) {
    const { cause: thrown } = unwound.failed;

    restore();

    if (mode == 'abort') chain(thrown, cause);

    run.halt('failed', thrown);
  }

  return restore;
}

function reset(run: Run, frame: Frame) {
  restore(run, frame._prior, frame._log);
  frame._armed++;

  Object.assign(frame, {
    _wrappers: new Map(),
    _log: [],
    _changed: new Set(),
    _items: [],
    _wrote: new Set(),
    _prior: {},
    _on: [],
    _violation: undefined,
    _late: undefined
  });
}

async function unwind(run: Run, cause: unknown, mode: Mode, ids?: Set<string>): Promise<Unwound> {
  const { control, _entries: entries } = run;
  const pending = entries.filter((entry) => (ids ? ids.has(entry.id) : !run._spent.has(entry.id)));
  const kept = new Set<string>();
  const undone: Steps.Entry[] = [];
  let halted = mode == 'stop';

  for (const entry of pending.reverse()) {
    const on = run._on.get(entry.id);
    const open = !run._finished.has(entry.id);

    if (ids && run._halted) break;
    if (entry.unwound == 'failed') break;

    if (!halted && (entry.irreversible || entry.committed)) {
      entry.halted = halted = true;

      if (entry.irreversible)
        console.warn(`${control._self} stopped unwinding at ${entry.id}: ${entry.irreversible.join(', ')} cannot be restored.`);
    }

    if (!on && 'error' in entry) continue;

    try {
      if (open) await fire(run, on, 'abort', mode == 'error' ? cause : undefined, kept);
      if (!halted && !run._reset.has(entry.id)) await fire(run, on, 'reset', undefined, kept);

      run._finished.add(entry.id);

      if (open) await fire(run, on, 'close', undefined, kept);
    } catch (thrown) {
      entry.unwound = 'failed';
      return { undone, kept, failed: { cause: thrown } };
    }

    run._spent.add(entry.id);

    if (halted) continue;
    if (on?.some((handler) => handler.kind == 'reset') || (run._held.has(entry.id) && entry.wrote.length)) entry.unwound = true;

    undone.push(entry);
  }

  return { undone, kept };
}

async function compensate(run: Run, item: Steps.Node, cause: unknown, kept: Set<string>, bare?: boolean) {
  const fn = run._inline.get(item.id);

  if (!fn) return undo(run, [item], kept);

  const frame = new Frame(run, { id: item.id, key: item.key, args: item.args, _undo: true, _owner: run._owner.get(item.id) });

  run.frames.add(frame);

  try {
    await (bare ? fn() : fn(cause));
  } finally {
    run.frames.delete(frame);
    frame._abort.abort();
    for (const key of frame._wrote) kept.add(key);
  }

  await undo(run, frame._items, kept);
}

async function undo(run: Run, items: Steps.Node[], kept: Set<string>): Promise<void> {
  for (const item of items)
    if (item.group) await Promise.all(item.group.map((member) => undo(run, [member], kept)));
    else {
      const frame = (await run.invoke(item, undefined, true))!;

      for (const key of frame._wrote) kept.add(key);

      await undo(run, frame._items, kept);
    }
}

function refill(run: Run, { undone, kept }: Unwound, into?: Frame, all?: boolean, within?: string) {
  const self = run.control._self as any;
  const prior = new Map<string, unknown>();
  const log: Log = [];

  for (const entry of undone) {
    const held = run._held.get(entry.id);

    if (!held) continue;

    for (const key in held.prior) prior.set(key, held.prior[key]);

    log.push(...[...held.log].reverse());
  }

  const since = (key: string) => !!within && !run.line(run._writer.get(key)!).includes(within);

  for (const [key, value] of prior) {
    const wrote = into?._wrote.has(key);

    if (wrote) into!._prior[key] = value;
    if (all || (!wrote && !kept.has(key) && !since(key))) self[key] = value;
  }

  for (const [key, undo] of log) if (all || (!into?._changed.has(key) && !since(key))) undo();
}

function blame(run: Run, cause: unknown) {
  run._error = cause;
  run.control.error = cause;
}

function restore(run: Run, prior: Record<string, unknown>, log: Log) {
  const self = run.control._self as any;

  for (const key in prior) self[key] = prior[key];
  for (const [, undo] of [...log].reverse()) undo();
}

export { blame, fire, recover, refill, reset, restore, rewind, unwind };

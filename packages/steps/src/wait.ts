import { get, Model } from '@expressive/mvc';
import { event } from '@expressive/mvc/observable';

import { Frame } from './frame';
import { Run } from './run';
import { Steps, Aborted } from './steps';
import type { Answer } from './types';
import { LONGEST, handle } from './util';

class Wait extends Model {
  run = get(Run);
  id = '';
  step = '';
  args: unknown[] = [];
  answers: string[] = [];
  until?: number = undefined;

  _from!: Frame;
  _park!: (answer?: Answer) => void;
  _answer?: Answer = undefined;
  _race?: Steps.Node = undefined;
  _open = true;

  protected new() {
    const { run, answers, until } = this;
    const { _self: self } = run.control;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const arm = () => {
      const left = until! - Date.now();

      timer = setTimeout(left > LONGEST ? arm : () => run.waits.delete(this), Math.min(left, LONGEST));
    };

    if (until !== undefined) arm();

    for (const key of answers) if (!accepts(run, key, this)) event(self, key);

    return () => {
      this._open = false;
      clearTimeout(timer);

      for (const key of answers) if (!accepts(run, key)) event(self, key);

      this._park(this._answer);
    };
  }
}

function route(run: Run, key: string, args: unknown[], from?: Frame) {
  const open = run.waits.filter((wait) => wait.answers.includes(key));

  return open.find((wait) => wait._from === from) || open.find((wait) => wait.args[0] === args[0]) || open[0];
}

function accepts(run: Run, key: string, except?: Wait) {
  return run.waits.any((wait) => wait !== except && wait._open && wait.answers.includes(key));
}

function racing(run: Run, item: Steps.Node) {
  const races = run.waits.filter((wait) => !!wait._race && wait.answers.includes(item.key));

  if (!races.length) return;

  const line = run.line(item.id);

  return races.find((wait) => line.includes(wait.id));
}

function lose(run: Run, wait: Wait, won: string[], answer: Steps.Node) {
  const race = wait._race!;
  const losers = (race.group || [race]).filter((racer) => !won.includes(racer.id));
  const cause = new Aborted(`${answer.key} answered ${wait.id}.`);

  for (const racer of losers) {
    run._dropped.add(racer.id);
    run._version++;
    run._lost.add(racer.id);
  }

  for (const frame of run.discard()) frame._abort.abort(cause);
  for (const [release, from] of run._holding) if (run.dropped(from)) release();

  for (const racer of losers)
    run._losing.set(
      racer.id,
      run.serial(async () => {
        await quiet(run, racer.id);
        (await run.recover(racer, cause, 'abort'))(undefined, false, racer.id);
      })
    );
}

function quiet(run: Run, id: string) {
  const busy = () => run.flight().some((frame) => run.line(frame.id).includes(id));

  return new Promise<void>((resolve) => {
    const check = () => {
      if (busy()) return;

      run._quiet.delete(check);
      resolve();
    };

    run._quiet.add(check);
    check();
  });
}

function park(run: Run, item: Steps.Node, from: Frame) {
  return new Promise<Answer | undefined>((resolve) => {
    const { id, answers, race, args } = item;
    const until = answers!.length ? undefined : Date.now() + (args[0] as number);

    run.waits.add({ id, step: from.key, args: from.args, answers, until, _race: race, _from: from, _park: resolve });

    if (race) void run.exec(race, from);
  });
}

function wake(run: Run, wait: Wait, key: string, args: unknown[], node = run.node(key, args)) {
  const { _ticket } = run;
  let done!: () => void;
  let fail!: (error: unknown) => void;

  const answered = handle<void>(_ticket, (res, rej) => {
    done = res;
    fail = rej;
  });

  const answer = { done: () => (run._halted ? fail(run.reason()) : done()), fail } as Answer;
  const won = run.line(node.id);

  wait._answer = answer;
  run._parent.set(node.id, wait.id);
  run._version++;
  run.waits.delete(wait);

  if (wait._race) lose(run, wait, won, node);

  answer.frame = run.invoke(node, wait.id);

  return answered;
}

export { Wait, accepts, lose, park, quiet, racing, route, wake };

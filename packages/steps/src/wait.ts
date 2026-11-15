import { get, Model } from '@expressive/mvc';
import { event } from '@expressive/mvc/observable';

import { Frame } from './frame';
import { Run } from './run';
import { Steps } from './steps';
import type { Answer } from './types';
import { LONGEST } from './util';

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

    for (const key of answers) if (!run.accepts(key, this)) event(self, key);

    return () => {
      this._open = false;
      clearTimeout(timer);

      for (const key of answers) if (!run.accepts(key)) event(self, key);

      this._park(this._answer);
    };
  }
}

export { Wait };

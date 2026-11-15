import assert from 'node:assert/strict';
import { Model } from '@expressive/mvc';
import { arg, command, flag } from '@expressive/cli';

const lines = [];
const out = { log: (line) => lines.push(String(line)), error: (line) => lines.push('! ' + line) };

class Greet extends Model {
  name = arg({ required: true });
  loud = flag({ short: 'l' });

  run() {
    return this.loud ? `HI ${this.name}` : `hi ${this.name}`;
  }
}

assert.equal(await command(Greet)(['ann', '-l'], out), 0);
assert.deepEqual(lines, ['HI ann']);
assert.equal(await command(Greet)([], out), 2);

console.log('cli: command from argv ok');

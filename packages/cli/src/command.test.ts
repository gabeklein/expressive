import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { get, Model } from '@expressive/mvc';
import { Steps } from '@expressive/steps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { command, main } from './command';
import { arg, args, flag, list, opt, cmd } from './input';

let lines: string[];

const out = {
  log: (line: unknown) => void lines.push(String(line)),
  error: (line: unknown) => void lines.push('! ' + line)
};

const call = (Type: Model.Type, ...argv: string[]) => command(Type)(argv, out);

class Leaf extends Model {
  run() {}
}

beforeEach(() => {
  lines = [];
});

class Lint extends Model {
  config = arg({ required: true, help: 'rules to apply' });
  files = args({ min: 1 });
  fix = flag({ short: 'f' });
  level = opt({ default: 'warn' });

  run() {
    lines.push(`${this.config} ${this.files.join(' ')} fix=${this.fix} level=${this.level}`);
  }
}

it('will run with values from argv', async () => {
  expect(await call(Lint, 'rules', 'a.ts', 'b.ts', '-f', '--level=error')).toBe(0);
  expect(lines).toEqual(['rules a.ts b.ts fix=true level=error']);
});

it('will fill fields before new()', async () => {
  class Test extends Model {
    name = opt();
    seen?: string;

    new() {
      this.seen = this.name;
    }

    run() {
      return this.seen;
    }
  }

  expect(await call(Test, '--name', 'x')).toBe(0);
  expect(lines).toEqual(['x']);
});

it('will print usage and return 2 on bad input', async () => {
  expect(await call(Lint, 'rules')).toBe(2);
  expect(lines).toEqual(['! <files> needs at least 1 value.\nUsage: lint [options] <config> <files...>']);
});

it('will print help and return 0', async () => {
  expect(await call(Lint, '--help')).toBe(0);
  expect(lines[0]).toMatch(/^Usage: lint \[options\] <config> <files\.\.\.>\n\nArguments:\n {2}<config> {4}rules to apply/);
});

it('will name the command from its class', async () => {
  class SqlSync extends Leaf {}

  await call(SqlSync, '-h');

  expect(lines[0]).toMatch(/^Usage: sql-sync \[options\]/);
});

it('will map results to exit codes', async () => {
  const returns = (value: unknown) =>
    class Test extends Model {
      run() {
        return value;
      }
    };

  expect(await command(returns(undefined))([], out)).toBe(0);
  expect(await command(returns(true))([], out)).toBe(0);
  expect(await command(returns(false))([], out)).toBe(1);
  expect(await command(returns(7))([], out)).toBe(7);
  expect(await command(returns(Promise.resolve(3)))([], out)).toBe(3);
  expect(await command(returns('done'))([], out)).toBe(0);
  expect(lines).toEqual(['done']);
});

it('will print a throw and return 1', async () => {
  class Test extends Model {
    async run() {
      throw new Error('broke');
    }
  }

  class Odd extends Model {
    run() {
      throw 'odd';
    }
  }

  expect(await call(Test)).toBe(1);
  expect(await call(Odd)).toBe(1);
  expect(lines).toEqual(['! broke', '! odd']);
});

it('will report inputs declared in an unfillable order', async () => {
  class Test extends Leaf {
    files = args();
    last = arg();
  }

  expect(await call(Test)).toBe(1);
  expect(lines).toEqual(['! <files> takes the remaining arguments - <last> cannot follow it.']);
});

it('will destroy the instance after', async () => {
  const created = vi.fn();
  const destroyed = vi.fn();

  class Test extends Leaf {
    new() {
      created();
      return destroyed;
    }
  }

  await call(Test);
  expect(destroyed).toHaveBeenCalledTimes(1);

  await call(Test, '--nope');
  expect(created).toHaveBeenCalledTimes(1);
});

it('will fail for a class without run', async () => {
  class Test extends Model {}

  expect(await call(Test)).toBe(1);
  expect(lines).toEqual(['! Test has no run() method.']);
});

it('will run a Steps class', async () => {
  class Deploy extends Steps {
    version = arg({ required: true });
    hosts: string[] = [];

    async run() {
      this.build();
      this.release();

      await this;

      return this.hosts.length;
    }

    build() {
      this.hosts = ['a', 'b'];
    }

    release() {
      lines.push(`released ${this.version} to ${this.hosts.join(', ')}`);
    }
  }

  expect(await call(Deploy, '1.4.0')).toBe(2);
  expect(lines).toEqual(['released 1.4.0 to a, b']);
});

describe('cmd', () => {
  class Sync extends Model {
    entry = arg({ required: true });
    force = flag({ help: 'rebuild drifted columns' });

    run() {
      lines.push(`sync ${this.entry} force=${this.force}`);
    }
  }

  class Sql extends Model {
    entry = arg({ required: true });

    check = cmd({
      help: 'list what sync would change',
      run: () => void lines.push(`check ${this.entry}`)
    });

    sync = cmd({ from: Sync, help: 'apply schema changes' });
  }

  describe('routing', () => {
    it('will route to a class sub', async () => {
      expect(await call(Sql, 'sync', 'db.ts', '--force')).toBe(0);
      expect(lines).toEqual(['sync db.ts force=true']);
    });

    it('will run an inline sub with the parent inputs', async () => {
      expect(await call(Sql, 'check', 'db.ts')).toBe(0);
      expect(lines).toEqual(['check db.ts']);
    });

    it('will route a kebab-cased inline sub, called on the parent', async () => {
      class Test extends Model {
        name = arg();

        dryRun = cmd({
          run() {
            lines.push((this as unknown as Test).name!);
          }
        });
      }

      expect(await call(Test, 'dry-run', 'x')).toBe(0);
      expect(lines).toEqual(['x']);
    });

    it('will refuse an option outside its owner', async () => {
      expect(await call(Sql, '--force', 'sync', 'db.ts')).toBe(2);
      expect(await call(Sql, 'check', 'db.ts', '--force')).toBe(2);
      expect(lines).toEqual([
        '! Unknown option --force.\nUsage: sql [options] <command> <entry>',
        '! Unknown option --force.\nUsage: sql check [options] <entry>'
      ]);
    });

    it('will fail on an unknown command', async () => {
      class Group extends Model {
        sync = cmd({ from: Sync });
      }

      expect(await call(Group, 'nope')).toBe(2);
      expect(await call(Sql, 'drop', 'db.ts')).toBe(2);
      expect(lines).toEqual([
        '! Unknown command "nope".\nUsage: group [options] <command>',
        '! Unknown command "drop".\nUsage: sql [options] <command> <entry>'
      ]);
    });

    it('will fill args once routing ends', async () => {
      class Test extends Model {
        name = arg();
        sync = cmd({ from: Sync });

        run() {
          lines.push(`run ${this.name} ${this.sync}`);
        }
      }

      await call(Test, 'other');
      await call(Test, '--', 'sync');
      await call(Test);

      expect(lines).toEqual(['run other undefined', 'run sync undefined', 'run undefined undefined']);
    });

    it('will not route a group after --', async () => {
      expect(await call(Sql, '--', 'sync')).toBe(2);
      expect(lines).toEqual(['! Unexpected argument "sync".\nUsage: sql [options] <command> <entry>']);
    });

    it('will leave parent args unfilled when routed to a class sub', async () => {
      class Child extends Model {
        parent = get(Parent);
        name = arg();

        run() {
          lines.push(`${this.parent.entry} ${this.name}`);
        }
      }

      class Parent extends Model {
        entry = arg({ required: true });
        child = cmd({ from: Child });
      }

      expect(await call(Parent, 'child', 'x')).toBe(0);
      expect(lines).toEqual(['undefined x']);
    });

    it('will fail a sub with no run', async () => {
      class Empty extends Model {}

      class Test extends Model {
        empty = cmd({ from: Empty });
      }

      expect(await call(Test, 'empty')).toBe(1);
      expect(lines).toEqual(['! Empty has no run() method.']);
    });
  });

  describe('help', () => {
    it('will print help for a group run alone, and return 0', async () => {
      expect(await call(Sql)).toBe(0);
      expect(lines[0]).toMatch(
        /^Usage: sql \[options\] <command> <entry>\n\nArguments:\n {2}<entry>\n\nCommands:\n {2}check {2}list what sync would change\n {2}sync {3}apply schema changes/
      );
    });

    it('will print help for a group when asked, before other errors', async () => {
      expect(await call(Sql, '--help')).toBe(0);
      expect(await call(Sql, '-h', 'nope')).toBe(0);
      expect(lines[0]).toMatch(/^Usage: sql \[options\] <command> <entry>\n[^]*Commands:/);
      expect(lines[1]).toBe(lines[0]);
    });

    it('will print help for the routed path', async () => {
      expect(await call(Sql, 'sync', '--help')).toBe(0);
      expect(await call(Sql, 'check', '--help')).toBe(0);
      expect(lines[0]).toMatch(/^Usage: sql sync \[options\] <entry>\n[^]*--force +rebuild drifted columns/);
      expect(lines[1]).toMatch(/^Usage: sql check \[options\] <entry>/);
      expect(lines[1]).not.toMatch(/Commands:/);
    });

    it('will print help for help in place of a command', async () => {
      expect(await call(Sql, 'help')).toBe(0);
      expect(await call(Sql, 'help', 'sync')).toBe(0);
      expect(lines[0]).toMatch(/^Usage: sql \[options\] <command> <entry>/);
      expect(lines[1]).toMatch(/^Usage: sql sync \[options\] <entry>/);
    });

    it('will name help after the invoked path', async () => {
      expect(await command(Sql)(['sync', '--help'], out, 'kit sql')).toBe(0);
      expect(lines[0]).toMatch(/^Usage: kit sql sync \[options\] <entry>/);
    });

    it('will print help for a class with no run', async () => {
      class Empty extends Model {}

      expect(await call(Empty, '--help')).toBe(0);
      expect(lines).toEqual(['Usage: empty [options]\n\nOptions:\n  -h, --help  show this help']);
    });
  });

  describe('options', () => {
    it('will float options over the path, filled before any new()', async () => {
      const seen: string[] = [];

      class Last extends Model {
        root = get(Root);
        deep = flag();

        new() {
          seen.push(`last new: entry=${this.root.entry} deep=${this.deep}`);
        }

        run() {
          lines.push(`last ${this.root.entry} ${this.root.middle?.depth}`);
        }
      }

      class Middle extends Model {
        depth = opt({ type: 'number' });
        last = cmd({ from: Last });

        new() {
          seen.push(`middle new: depth=${this.depth}`);
        }
      }

      class Root extends Model {
        entry = opt();
        middle = cmd({ from: Middle });

        new() {
          seen.push(`root new: middle=${!!this.middle}`);
        }
      }

      expect(await call(Root, 'middle', 'last', '--entry', 'x', '--deep', '--depth', '2')).toBe(0);
      expect(lines).toEqual(['last x 2']);
      expect(seen).toEqual(['last new: entry=x deep=true', 'middle new: depth=2', 'root new: middle=true']);
    });

    it('will share an option across levels, read by the deepest definition', async () => {
      class Child extends Model {
        size = opt({ parse: (value) => value.length });
        quiet = flag();
        level = opt({ default: 'child' });

        run() {
          lines.push(`child ${this.size} ${this.quiet} ${this.level}`);
        }
      }

      class Parent extends Model {
        size = opt({ parse: (value) => ({ value }) });
        quiet = flag({ short: 'q' });
        level = opt({ default: 'parent' });
        child = cmd({ from: Child });

        new() {
          return () => lines.push(`parent ${this.size} ${this.quiet} ${this.level}`);
        }
      }

      await call(Parent, 'child');
      await call(Parent, '--size', 'abc', '-q', 'child', '--level', 'x');
      await call(Parent, '--quiet', 'child', '--no-quiet');

      expect(lines).toEqual([
        'child undefined false child',
        'parent undefined false parent',
        'child 3 true x',
        'parent 3 true x',
        'child undefined false child',
        'parent undefined false parent'
      ]);
    });

    it('will check counts and required per level', async () => {
      class Child extends Leaf {
        tags = list({ default: ['d'] });
        name = opt({ default: 'child' });
      }

      class Parent extends Model {
        tags = list({ min: 1 });
        name = opt({ required: true });
        child = cmd({ from: Child });
      }

      expect(await call(Parent, 'child', '--name', 'x')).toBe(2);
      expect(await call(Parent, 'child', '--tags', 'a')).toBe(2);
      expect(await call(Parent, 'child', '--tags', 'a', '--name', 'x')).toBe(0);
      expect(lines).toEqual([
        '! --tags needs at least 1 value.\nUsage: parent child [options]',
        '! Missing --name.\nUsage: parent child [options]'
      ]);
    });

    it('will fail options declared inconsistently across levels', async () => {
      class Kind extends Leaf {
        port = list();
      }

      class Type extends Leaf {
        size = opt();
      }

      class Split extends Leaf {
        tags = list({ split: ',' });
      }

      class Short extends Leaf {
        fix = flag({ short: 'f' });
      }

      class Parent extends Model {
        port = opt();
        size = opt({ type: 'number' });
        tags = list();
        force = flag({ short: 'f' });
        kind = cmd({ from: Kind });
        type = cmd({ from: Type });
        split = cmd({ from: Split });
        short = cmd({ from: Short });
      }

      for (const name of ['kind', 'type', 'split', 'short']) expect(await call(Parent, name)).toBe(1);

      expect(lines).toEqual([
        '! --port is declared differently by Parent (opt) and Kind (list).',
        '! --size is declared differently by Parent (number) and Type (string).',
        '! --tags is declared differently by Parent (no split) and Split (split ",").',
        '! -f is declared by both --force and --fix.'
      ]);
    });
  });

  describe('lazy', () => {
    it('will load a lazy sub once, when routed', async () => {
      const created = vi.fn();

      class Late extends Model {
        run() {
          lines.push('late');
        }
      }

      const load = vi.fn(async () => ({ default: Late }));

      class Test extends Leaf {
        late = cmd({ lazy: load, help: 'late' });

        new() {
          created();
        }
      }

      const run = command(Test);

      await run([], out);
      expect(load).not.toHaveBeenCalled();

      await run(['late'], out);
      await run(['late'], out);

      expect(load).toHaveBeenCalledTimes(1);
      expect(created).toHaveBeenCalledTimes(3);
      expect(lines).toEqual(['late', 'late']);
    });

    it('will load each lazy level of a path', async () => {
      let loads = 0;

      class Last extends Model {
        run() {
          lines.push('last');
        }
      }

      class Middle extends Model {
        last = cmd({ lazy: async () => (loads++, { default: Last }), help: 'last' });
      }

      class Root extends Model {
        middle = cmd({ lazy: async () => (loads++, { default: Middle }), help: 'middle' });
      }

      const run = command(Root);

      expect(await run(['middle', 'last'], out)).toBe(0);
      expect(await run(['middle', 'last'], out)).toBe(0);
      expect(loads).toBe(2);
      expect(lines).toEqual(['last', 'last']);
    });

    it('will fail a lazy command whose module has no default class', async () => {
      class Test extends Model {
        thrown = cmd({
          help: 'thrown',
          lazy: async () => {
            throw new Error('not found');
          }
        });
        named = cmd({ lazy: async () => ({ Late: class {} }) as any, help: 'named' });
        empty = cmd({ lazy: async () => 0 as any, help: 'empty' });
        bare = cmd({ lazy: async () => Test as any, help: 'bare' });
      }

      for (const name of ['thrown', 'named', 'empty', 'bare']) expect(await call(Test, name)).toBe(1);

      expect(lines).toEqual([
        '! not found',
        '! Command "named" did not load a Model class.',
        '! Command "empty" did not load a Model class.',
        '! Command "bare" did not load a Model class.'
      ]);
    });
  });

  describe('lifecycle', () => {
    it('will destroy the path, child first', async () => {
      class Child extends Leaf {
        new() {
          return () => lines.push('child destroyed');
        }
      }

      class Parent extends Model {
        child = cmd({ from: Child });

        new() {
          return () => lines.push('parent destroyed');
        }
      }

      await call(Parent, 'child');

      expect(lines).toEqual(['child destroyed', 'parent destroyed']);
    });

    it('will tear down field children when the build aborts', async () => {
      let loads = 0;

      class Logger extends Model {
        new() {
          lines.push('logger new');
          return () => lines.push('logger destroyed');
        }
      }

      class Late extends Leaf {
        logger = new Logger();
      }

      class Test extends Model {
        logger = new Logger();
        late = cmd({ lazy: async () => (loads++, { default: Late }), help: 'late' });
      }

      expect(await call(Test, '--nope')).toBe(2);
      expect(await call(Test, 'late')).toBe(0);
      expect(loads).toBe(1);
      expect(lines).toEqual([
        'logger new',
        'logger destroyed',
        '! Unknown option --nope.\nUsage: test [options] <command>',
        'logger new',
        'logger destroyed',
        'logger new',
        'logger new',
        'logger destroyed',
        'logger destroyed'
      ]);
    });

    it('will wait for async new() on the path before run', async () => {
      class Child extends Model {
        ready = false;

        async new() {
          await new Promise((resolve) => setTimeout(resolve, 1));
          this.ready = true;
        }

        run() {
          lines.push(`ready ${this.ready}`);
        }
      }

      class Parent extends Model {
        child = cmd({ from: Child });
      }

      expect(await call(Parent, 'child')).toBe(0);
      expect(lines).toEqual(['ready true']);
    });

    it('will fail when an async new() rejects', async () => {
      const ran = vi.fn();

      class Test extends Model {
        async new() {
          throw new Error('no connection');
        }

        run() {
          ran();
        }
      }

      expect(await call(Test)).toBe(1);
      expect(lines).toEqual(['! no connection']);
      expect(ran).not.toHaveBeenCalled();
    });

    it('will pass on setup errors from Models off the path', async () => {
      const caught = vi.fn();
      const stop = Model.on({ catch: (error) => void caught(error) });

      class Other extends Model {
        async new() {
          throw new Error('elsewhere');
        }
      }

      class Test extends Model {
        async run() {
          Other.new();
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      }

      expect(await call(Test)).toBe(0);
      stop();

      expect(caught).toHaveBeenCalledWith(new Error('elsewhere'));
    });
  });
});

describe('peer', () => {
  let root: string;
  const { argv } = process;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'expressive-cmd-')));
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    process.argv = [argv[0], ''];
  });

  afterEach(() => {
    process.argv = argv;
    vi.restoreAllMocks();
    rmSync(root, { recursive: true });
  });

  function install(name: string, bin: unknown, source: string) {
    const dir = join(root, 'node_modules', name);

    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, bin }));
    writeFileSync(join(dir, 'bin.mjs'), source);
  }

  class Sql extends Model {
    entry = arg();

    run() {
      lines.push(`sql ${this.entry}`);
    }
  }

  class Kit extends Model {
    sql = cmd({ peer: '@kit/sql', help: 'sync your schema' });
    dev = cmd({ peer: '@kit/dev', help: 'dev server' });
  }

  it('will run the default export of its bin named after the root', async () => {
    (globalThis as any).kitSql = Sql;
    install('@kit/sql', { kit: 'bin.mjs' }, 'export default globalThis.kitSql;');

    expect(await call(Kit, 'sql', 'db.ts')).toBe(0);
    expect(await call(Kit, 'sql', '--help')).toBe(0);
    expect(lines[0]).toBe('sql db.ts');
    expect(lines[1]).toMatch(/^Usage: kit sql \[options\] \[entry\]/);
  });

  it('will mark a missing peer in help and hint how to install it', async () => {
    install('@kit/sql', { kit: 'bin.mjs' }, '');

    expect(await call(Kit)).toBe(0);
    expect(await call(Kit, 'dev', '--port', '1')).toBe(2);
    expect(lines).toEqual([
      'Usage: kit [options] <command>\n\nCommands:\n  sql  sync your schema\n  dev  dev server (not installed)\n\nOptions:\n  -h, --help  show this help',
      '! "kit dev" is not installed - npm i -D @kit/dev'
    ]);
  });

  it('will fail a peer without the bin', async () => {
    install('@kit/sql', { other: 'bin.mjs' }, '');

    expect(await call(Kit, 'sql')).toBe(1);
    expect(lines).toEqual(['! @kit/sql has no "kit" bin.']);
  });

  describe('main', () => {
    it('will run only as the entry', async () => {
      const script = join(root, 'bin.mjs');
      const url = pathToFileURL(script).href;
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { exitCode } = process;

      writeFileSync(script, '');
      writeFileSync(join(root, 'other.mjs'), '');
      process.argv = [argv[0], script, 'db.ts'];

      try {
        await main({ url, main: false }, Sql);
        expect(lines).toEqual([]);

        await main({ url: pathToFileURL(join(root, 'other.mjs')).href }, Sql);
        expect(lines).toEqual([]);

        await main({ url }, Sql);
        await main({ url: 'file:///nowhere.mjs', main: true }, Sql);
        expect(lines).toEqual(['sql db.ts', 'sql db.ts']);
        expect(process.exitCode).toBe(0);

        process.argv = [argv[0]];
        await main({ url }, Sql);
        expect(lines).toHaveLength(2);
        expect(log).not.toHaveBeenCalled();
      } finally {
        process.exitCode = exitCode;
      }
    });
  });
});

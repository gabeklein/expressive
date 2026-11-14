import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it } from 'vitest';

import { trunk } from './bin';

let root: string;
let lines: string[];
let argv1: string;

const out = { log: (line: string) => void lines.push(line), error: (line: string) => void lines.push('! ' + line) };
const run = (args: string[], output: typeof out, name: string | undefined, cwd: string) =>
  trunk('kit', cwd)(args, output, name);

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'expressive-bin-')));
  lines = [];
  argv1 = process.argv[1];
});

afterEach(() => {
  process.argv[1] = argv1;
  rmSync(root, { recursive: true });
});

function write(dir: string, manifest: unknown) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), typeof manifest == 'string' ? manifest : JSON.stringify(manifest));
}

function module(dir: string, label: string, code = 0) {
  writeFileSync(
    join(dir, 'cli.mjs'),
    `export default async (args, out, name) => (out.log(name + ': ${label} ' + args.join(' ')), ${code});\n`
  );
}

function install(at: string, name: string, manifest: Record<string, unknown>, code = 0) {
  const dir = join(at, 'node_modules', name);

  write(dir, { name, ...manifest });
  module(dir, name, code);
}

function project(at: string, deps: string[], own: Record<string, unknown> = {}) {
  write(at, { name: 'app', devDependencies: Object.fromEntries(deps.map((dep) => [dep, '*'])), ...own });
}

it("will run a dependency's command under its unscoped name", async () => {
  project(root, ['@kit/sql']);
  install(root, '@kit/sql', { kit: { bin: './cli.mjs' } }, 3);

  expect(await run(['sql', 'check', 'x.ts'], out, undefined, root)).toBe(3);
  expect(lines).toEqual(['kit sql: @kit/sql check x.ts']);
});

it('will not offer packages the project does not declare', async () => {
  project(root, []);
  install(root, '@kit/sql', { kit: { bin: './cli.mjs' } });

  expect(await run(['sql'], out, undefined, root)).toBe(2);
  expect(lines).toEqual(['! Unknown command "sql". Run "kit help" for a list.']);
});

it('will list commands, with suggestions to install, for no command or help', async () => {
  project(root, ['dev', 'missing', 'broken', 'plain']);
  writeFileSync(join(root, 'bun.lock'), '');
  install(root, 'dev', {
    kit: {
      bin: { dev: './cli.mjs', build: './cli.mjs' },
      help: { dev: 'dev server' },
      suggest: {
        sql: { package: '@kit/sql', help: 'sync your schema' },
        lint: { package: 'kit-lint' },
        build: { package: 'other' }
      }
    }
  });
  install(root, 'plain', { kit: { suggest: { sql: { package: 'ignored' } } } });
  write(join(root, 'node_modules', 'broken'), '{');

  for (const args of [[], ['help'], ['--help'], ['-h']]) expect(await run(args, out, undefined, root)).toBe(0);

  expect(new Set(lines)).toEqual(
    new Set([
      [
        'Usage: kit <command> [options]',
        'Commands:\n  dev    dev server\n  build  dev',
        'Not installed:\n  sql   sync your schema - bun add -d @kit/sql\n  lint  bun add -d kit-lint',
        'Run "kit <command> --help" for a command\'s inputs.'
      ].join('\n\n')
    ])
  );
});

it('will run a suggested command only once installed', async () => {
  project(root, ['dev']);
  install(root, 'dev', { kit: { bin: { dev: './cli.mjs' }, suggest: { sql: { package: '@kit/sql' } } } });

  expect(await run(['sql'], out, undefined, root)).toBe(2);
  expect(lines).toEqual(['! "kit sql" is not installed - npm i -D @kit/sql']);
});

it('will run help for a command', async () => {
  project(root, ['@kit/sql']);
  install(root, '@kit/sql', { kit: { bin: './cli.mjs', help: 'sync your schema' } });

  expect(await run(['help', 'sql', 'sync'], out, 'tool', root)).toBe(0);
  expect(lines).toEqual(['tool sql: @kit/sql sync --help']);
});

it("will offer the project's own commands", async () => {
  project(root, [], { kit: { bin: { seed: './cli.mjs' } } });
  module(root, 'own');

  expect(await run(['seed', 'a'], out, undefined, root)).toBe(0);
  expect(lines).toEqual(['kit seed: own a']);
});

it('will prefer the nearest package.json, and see a workspace root', async () => {
  const app = join(root, 'packages', 'app');

  project(root, ['dev', 'sql']);
  project(app, ['dev']);
  install(root, 'sql', { kit: { bin: './cli.mjs' } }, 4);
  install(root, 'dev', { kit: { bin: './cli.mjs' } }, 5);
  install(app, 'dev', { kit: { bin: './cli.mjs' } }, 6);

  expect(await run(['sql'], out, undefined, app)).toBe(4);
  expect(await run(['dev'], out, undefined, app)).toBe(6);
});

it('will warn when two packages claim a name, keeping the first', async () => {
  project(root, ['b-sql', 'a-sql']);
  install(root, 'a-sql', { kit: { bin: { sql: './cli.mjs' } } }, 1);
  install(root, 'b-sql', { kit: { bin: { sql: './cli.mjs' } } }, 2);

  expect(await run(['sql'], out, undefined, root)).toBe(1);
  expect(lines).toEqual(['! "sql" is claimed by a-sql and b-sql - using a-sql.', 'kit sql: a-sql ']);
});

it('will let the project pin and rename commands', async () => {
  const app = join(root, 'app');

  project(root, ['a-sql', 'b-sql'], { kit: { commands: { sql: 'b-sql#sql', other: 'b-sql#nope' } } });
  project(app, ['a-sql'], { kit: { commands: { db: 'a-sql#sql', t: '@kit/tool' } } });
  install(root, '@kit/tool', { kit: { bin: './cli.mjs' } }, 9);
  install(root, 'a-sql', { kit: { bin: { sql: './cli.mjs' } } }, 1);
  install(root, 'b-sql', { kit: { bin: { sql: './cli.mjs' } } }, 2);

  expect(await run(['db'], out, undefined, app)).toBe(1);
  expect(await run(['t'], out, undefined, app)).toBe(9);
  expect(await run(['sql'], out, undefined, app)).toBe(1);
  expect(await run(['sql'], out, undefined, root)).toBe(2);
  expect(lines.filter((line) => line[0] == '!')).toEqual(
    Array(4).fill('! "other" points to b-sql#nope, which provides no such command.')
  );
});

it('will offer commands of the running script outside a project', async () => {
  const pkg = join(root, 'global', 'node_modules', 'kit');
  const bare = join(root, 'bare');

  install(join(root, 'global'), 'kit', { kit: { bin: { dev: './cli.mjs' } } }, 7);
  mkdirSync(bare);
  mkdirSync(join(pkg, 'dist'));
  writeFileSync(join(pkg, 'dist', 'bin.js'), '');

  process.argv[1] = join(pkg, 'dist', 'bin.js');
  expect(await run(['dev'], out, undefined, bare)).toBe(7);

  writeFileSync(join(bare, 'loose.js'), '');

  for (const script of [join(bare, 'loose.js'), join(bare, 'nope.js'), '']) {
    process.argv[1] = script;
    expect(await run([], out, undefined, bare)).toBe(0);
    expect(lines.at(-1)).toContain('Commands:\n  none installed');
  }
});

it('will discover from the working directory by default', async () => {
  expect(await trunk('kit')([], out)).toBe(0);
  expect(lines[0]).toMatch(/^Usage: kit <command>/);
});

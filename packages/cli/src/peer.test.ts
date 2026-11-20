import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { described, discover, install, locate, owner, peer } from './peer';

let root: string;
const { argv } = process;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'expressive-peer-')));
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  process.argv = [argv[0], ''];
});

afterEach(() => {
  process.argv = argv;
  vi.restoreAllMocks();
  rmSync(root, { recursive: true });
});

function pkg(at: string, name: string, bin?: unknown, extra?: object) {
  const dir = join(at, 'node_modules', name);

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, bin, ...extra }));

  return dir;
}

it('will find a package from the working directory upward', () => {
  const app = join(root, 'app');
  const dir = pkg(root, '@kit/sql', { kit: 'bin.js' });

  writeFileSync(join(dir, 'bin.js'), '');
  mkdirSync(app);
  vi.mocked(process.cwd).mockReturnValue(app);

  expect(locate('@kit/sql')).toBe(dir);
  expect(peer('@kit/sql', 'kit')).toBe(join(dir, 'bin.js'));
  expect(locate('@kit/dev')).toBeUndefined();
  expect(peer('@kit/dev', 'kit')).toBeUndefined();
});

it('will find a package beside the running script', () => {
  const global = join(root, 'global');
  const dir = pkg(global, 'kit-dev', 'bin.js');
  const script = join(dir, 'bin.js');

  writeFileSync(script, '');
  process.argv[1] = script;
  vi.mocked(process.cwd).mockReturnValue(join(root, '..'));

  expect(peer('kit-dev', 'kit-dev')).toBe(script);

  process.argv[1] = join(root, 'missing.js');
  expect(locate('kit-dev')).toBeUndefined();
});

it('will throw for a package without the named bin', () => {
  pkg(root, 'kit-sql', 'bin.js');
  pkg(root, '@kit/dev');

  expect(() => peer('kit-sql', 'kit')).toThrow('kit-sql has no "kit" bin.');
  expect(() => peer('@kit/dev', 'kit')).toThrow('@kit/dev has no "kit" bin.');
});

it('will pick the install command by lockfile', () => {
  const app = join(root, 'app');

  mkdirSync(app);
  vi.mocked(process.cwd).mockReturnValue(app);

  expect(install('@kit/sql')).toBe('npm i -D @kit/sql');

  writeFileSync(join(root, 'pnpm-lock.yaml'), '');
  expect(install('@kit/sql')).toBe('pnpm add -D @kit/sql');

  writeFileSync(join(app, 'bun.lock'), '');
  expect(install('@kit/sql')).toBe('bun add -d @kit/sql');
});

describe('discover', () => {
  const list = (filter: RegExp, name = 'kit') => Object.fromEntries(discover(filter, name));

  it('will find packages passing the filter with the named bin', () => {
    pkg(root, '@kit/sql', { kit: 'bin.js' }, { description: 'sql things', commands: { kit: 'sync your schema' } });
    pkg(root, '@kit/dev', { kit: 'bin.js' }, { description: 'dev server' });
    pkg(root, '@kit/env', { kit: 'bin.js' });
    pkg(root, '@kit/mvc', undefined, { description: 'no bin' });
    pkg(root, '@other/cli', { kit: 'bin.js' });
    pkg(root, 'kit-lint', { kit: 'bin.js' });
    mkdirSync(join(root, 'node_modules', '@kit', 'broken'));
    mkdirSync(join(root, 'node_modules', '.bin'));

    expect(list(/^@kit\//)).toEqual({ dev: '@kit/dev', env: '@kit/env', sql: '@kit/sql' });
    expect(Object.keys(list(/^@kit\//))).toEqual(['dev', 'env', 'sql']);
    expect(Object.keys(list(/^kit-|^@other\//)).sort()).toEqual(['cli', 'kit-lint']);
    expect(list(/^@none\//)).toEqual({});
  });

  it('will prefer the nearest copy and the first of a name', () => {
    const app = join(root, 'app');

    pkg(root, '@kit/sql', { kit: 'bin.js' }, { description: 'outer' });
    pkg(root, '@kit/dev', { kit: 'bin.js' }, { description: 'outer' });
    pkg(app, '@kit/sql', { kit: 'bin.js' }, { description: 'inner' });
    pkg(app, '@kit/dev', { other: 'bin.js' });
    pkg(app, '@acme/sql', { kit: 'bin.js' }, { description: 'acme' });
    vi.mocked(process.cwd).mockReturnValue(app);

    expect(list(/^@(kit|acme)\//)).toEqual({ sql: '@acme/sql' });
  });

  it('will search beside a global bin', () => {
    const global = join(root, 'global', 'lib');
    const dir = pkg(global, '@kit/dev', { kit: 'bin.js' });

    pkg(global, '@kit/sql', { kit: 'bin.js' });
    writeFileSync(join(dir, 'bin.js'), '');
    process.argv[1] = join(dir, 'bin.js');
    vi.mocked(process.cwd).mockReturnValue(join(root, '..'));

    expect(Object.keys(list(/^@kit\//)).sort()).toEqual(['dev', 'sql']);
  });

  it('will find direct dependencies in a pnpm layout but not its hidden hoist', () => {
    const store = join(root, 'node_modules', '.pnpm');
    const sql = pkg(join(store, '@kit+sql@1.0.0'), '@kit/sql', { kit: 'bin.js' });

    pkg(join(store, '@kit+sql@1.0.0'), '@kit/cli', { kit: 'bin.js' }, { description: 'own dependency' });
    pkg(store, '@kit/dev', { kit: 'bin.js' }, { description: 'transitive' });
    mkdirSync(join(root, 'node_modules', '@kit'));
    symlinkSync(sql, join(root, 'node_modules', '@kit', 'sql'));
    writeFileSync(join(sql, 'bin.js'), '');

    expect(Object.keys(list(/^@kit\//))).toEqual(['sql']);

    process.argv[1] = join(root, 'node_modules', '@kit', 'sql', 'bin.js');
    expect(Object.keys(list(/^@kit\//))).toEqual(['sql', 'cli']);
  });
});

it('will find the package holding a file', () => {
  const dir = pkg(root, '@kit/sql', { kit: 'dist/bin.js' });

  mkdirSync(join(dir, 'dist'));

  expect(owner(join(dir, 'dist', 'bin.js'))).toBe('@kit/sql');
  expect(owner('/nowhere/bin.js')).toBeUndefined();
});

it('will read an installed package description', () => {
  pkg(root, '@kit/sql', undefined, { description: 'schema tools' });

  expect(described('@kit/sql')).toBe('schema tools');
  expect(described('@kit/dev')).toBeUndefined();
});

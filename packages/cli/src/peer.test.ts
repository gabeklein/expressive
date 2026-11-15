import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { install, locate, peer } from './peer';

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

function pkg(at: string, name: string, bin?: unknown) {
  const dir = join(at, 'node_modules', name);

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, bin }));

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

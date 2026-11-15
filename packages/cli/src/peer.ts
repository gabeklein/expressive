import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

const LOCKS: [string, string][] = [
  ['bun.lock', 'bun add -d'],
  ['bun.lockb', 'bun add -d'],
  ['pnpm-lock.yaml', 'pnpm add -D'],
  ['yarn.lock', 'yarn add -D']
];

function* upward(from: string) {
  for (let dir = from; ; dir = dirname(dir)) {
    yield dir;

    if (dirname(dir) == dir) return;
  }
}

function origins() {
  const script = process.argv[1];
  const found = [process.cwd()];

  if (script && existsSync(script)) found.push(dirname(realpathSync(script)));

  return found;
}

function locate(pkg: string) {
  for (const origin of origins())
    for (const dir of upward(origin)) {
      const at = join(dir, 'node_modules', pkg);

      if (existsSync(join(at, 'package.json'))) return at;
    }
}

/** Module path of `pkg`'s `bin` named `name`, or `undefined` when not installed. */
function peer(pkg: string, name: string) {
  const at = locate(pkg);

  if (!at) return;

  const { bin } = JSON.parse(readFileSync(join(at, 'package.json'), 'utf8'));
  const path = typeof bin == 'string' ? (pkg.replace(/^@[^/]+\//, '') == name ? bin : undefined) : bin?.[name];

  if (!path) throw new Error(`${pkg} has no "${name}" bin.`);

  return join(at, path);
}

/** Command that installs `pkg` as a dev dependency, by the lockfile nearest the working directory. */
function install(pkg: string) {
  for (const dir of upward(process.cwd())) {
    const lock = LOCKS.find(([file]) => existsSync(join(dir, file)));

    if (lock) return `${lock[1]} ${pkg}`;
  }

  return `npm i -D ${pkg}`;
}

export { install, locate, peer };

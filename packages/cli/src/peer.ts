import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

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

const manifest = (at: string) => JSON.parse(readFileSync(join(at, 'package.json'), 'utf8'));

const unscoped = (pkg: string) => pkg.replace(/^@[^/]+\//, '');

const binOf = (pkg: string, bin: unknown, name: string): string | undefined =>
  typeof bin == 'string' ? (unscoped(pkg) == name ? bin : undefined) : (bin as any)?.[name];

/** Module path of `pkg`'s `bin` named `name`, or `undefined` when not installed. */
function peer(pkg: string, name: string) {
  const at = locate(pkg);

  if (!at) return;

  const path = binOf(pkg, manifest(at).bin, name);

  if (!path) throw new Error(`${pkg} has no "${name}" bin.`);

  return realpathSync(join(at, path));
}

/** Command that installs `pkg` as a dev dependency, by the lockfile nearest the working directory. */
function install(pkg: string) {
  for (const dir of upward(process.cwd())) {
    const lock = LOCKS.find(([file]) => existsSync(join(dir, file)));

    if (lock) return `${lock[1]} ${pkg}`;
  }

  return `npm i -D ${pkg}`;
}

function* listing(at: string): Generator<[string, string]> {
  let entries: string[];

  try {
    entries = readdirSync(at);
  } catch {
    return;
  }

  for (const entry of entries.sort())
    if (entry[0] == '@') for (const [pkg, dir] of listing(join(at, entry))) yield [`${entry}/${pkg}`, dir];
    else if (entry[0] != '.') yield [entry, join(at, entry)];
}

/**
 * Installed packages whose name passes `filter` and whose `bin` has an entry `name` - command name to package.
 *
 * The command is the package name without its scope; entries are read in sorted order. Searches
 * `node_modules` from the working directory upward, then beside the running script; nearest copy
 * wins per package, first found per command.
 * pnpm's hidden hoist is skipped, so only declared dependencies are found.
 */
function discover(filter: RegExp, name: string) {
  const found = new Map<string, string>();
  const seen = new Set<string>();

  for (const origin of origins())
    for (const dir of upward(origin)) {
      if (basename(dir) == '.pnpm') continue;

      for (const [pkg, at] of listing(join(dir, 'node_modules'))) {
        filter.lastIndex = 0;

        if (seen.has(pkg) || !filter.test(pkg)) continue;

        seen.add(pkg);

        try {
          if (binOf(pkg, manifest(at).bin, name) && !found.has(unscoped(pkg))) found.set(unscoped(pkg), pkg);
        } catch {}
      }
    }

  return found;
}

/** Name of the package holding `file` - the nearest `package.json` with a name - or `undefined` outside one. */
function owner(file: string) {
  for (const dir of upward(dirname(file))) {
    const name = existsSync(join(dir, 'package.json')) && manifest(dir).name;

    if (name) return name as string;
  }
}

/** `description` of an installed package. */
function described(pkg: string) {
  const at = locate(pkg);

  return at && (manifest(at).description as string | undefined);
}

export { described, discover, install, locate, owner, peer, unscoped };

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { table } from './help';

/** Where a command writes - `console`, or a test double. */
type Output = Pick<Console, 'log' | 'error'>;

/**
 * A command module's default export - argv after the command name in, exit code out.
 *
 * `name` is the invoked command path, such as `"expressive sql"`, for help text. `command(Root)` from
 * `@expressive/cli` returns one.
 */
type Run = (args: string[], out: Output, name?: string) => Promise<number>;

interface Manifest {
  bin?: string | Record<string, string>;
  help?: string | Record<string, string>;
  suggest?: Record<string, { package: string; help?: string }>;
  commands?: Record<string, string>;
}

interface Found {
  module: string;
  package: string;
  help?: string;
}

const LOCKS: [string, string][] = [
  ['bun.lock', 'bun add -d'],
  ['bun.lockb', 'bun add -d'],
  ['pnpm-lock.yaml', 'pnpm add -D'],
  ['yarn.lock', 'yarn add -D'],
  ['package-lock.json', 'npm i -D']
];

function json(file: string): any {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return;
  }
}

function locate(pkg: string, from: string) {
  for (let dir = from; ; dir = dirname(dir)) {
    const at = join(dir, 'node_modules', pkg);

    if (existsSync(join(at, 'package.json'))) return at;
    if (dirname(dir) == dir) return;
  }
}

function owner(file: string) {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    if (dirname(dir) == dir) return;
  }
}

function provides(trunk: string, dir: string) {
  const pkg = json(join(dir, 'package.json')) || {};
  const manifest: Manifest = pkg[trunk] || {};
  const name = String(pkg.name);
  const { bin, help } = manifest;
  const named = typeof bin == 'string' ? { [name.replace(/^@[^/]+\//, '')]: bin } : bin || {};
  const found = new Map<string, Found>();

  for (const [command, module] of Object.entries(named))
    found.set(command, {
      module: join(dir, module),
      package: name,
      help: typeof help == 'string' ? help : help?.[command]
    });

  return { found, suggest: manifest.suggest || {}, commands: manifest.commands || {} };
}

function discover(trunk: string, cwd: string, out: Output) {
  const commands = new Map<string, Found>();
  const suggested = new Map<string, { package: string; help?: string }>();
  const pinned = new Set<string>();
  let install: string | undefined;

  const add = (from: ReturnType<typeof provides>, level: Map<string, Found>) => {
    for (const [name, entry] of from.found) {
      const other = level.get(name);

      if (commands.has(name) || pinned.has(name)) continue;

      if (other) out.error(`"${name}" is claimed by ${other.package} and ${entry.package} - using ${other.package}.`);
      else level.set(name, entry);
    }

    for (const [name, entry] of Object.entries(from.suggest))
      if (!suggested.has(name)) suggested.set(name, entry);
  };

  for (let dir = cwd; ; dir = dirname(dir)) {
    const project = json(join(dir, 'package.json'));

    install ||= LOCKS.find(([file]) => existsSync(join(dir, file)))?.[1];

    if (project) {
      const level = new Map<string, Found>();
      const own = provides(trunk, dir);

      for (const [name, target] of Object.entries(own.commands)) {
        const [pkg, command = pkg.replace(/^@[^/]+\//, '')] = target.split('#');
        const at = locate(pkg, dir);
        const entry = at && provides(trunk, at).found.get(command);

        pinned.add(name);

        if (entry && !commands.has(name)) level.set(name, entry);
        else if (!entry) out.error(`"${name}" points to ${target}, which provides no such command.`);
      }

      add(own, level);

      const deps = Object.keys({ ...project.dependencies, ...project.devDependencies }).sort();

      for (const dep of deps) {
        const at = locate(dep, dir);

        if (at) add(provides(trunk, at), level);
      }

      for (const [name, entry] of level) commands.set(name, entry);
    }

    if (dirname(dir) == dir) break;
  }

  const script = process.argv[1] && existsSync(process.argv[1]) ? owner(realpathSync(process.argv[1])) : undefined;

  if (script) add(provides(trunk, script), commands);

  for (const name of commands.keys()) suggested.delete(name);

  return { commands, suggested, install: install || 'npm i -D' };
}

function overview(trunk: string, found: ReturnType<typeof discover>) {
  const { commands, suggested, install } = found;
  const sections = [`Usage: ${trunk} <command> [options]`];

  sections.push(
    'Commands:\n' +
      (commands.size
        ? table([...commands].map(([name, entry]) => [name, entry.help || entry.package]))
        : '  none installed')
  );

  if (suggested.size)
    sections.push(
      'Not installed:\n' +
        table([...suggested].map(([name, entry]) => [name, `${entry.help ? entry.help + ' - ' : ''}${install} ${entry.package}`]))
    );

  sections.push(`Run "${trunk} <command> --help" for a command's inputs.`);

  return sections.join('\n\n');
}

/**
 * A command whose subcommands come from installed packages - the shared bin of a command family.
 *
 * Every `package.json` from `cwd` upward is read: its own `[name].bin`, then each of its dependencies'.
 * A string `bin` runs as the package name without scope; a record maps names to modules. `[name].help`
 * describes them, `[name].suggest` lists commands to install, and a project's `[name].commands` maps a
 * name to `"package"` or `"package#command"`, beating discovery. Nearer folders win; a clash within one
 * folder warns and keeps the first package by name. The package of the running script adds its own
 * commands last, so a global install still works.
 *
 * No command, `help` or `--help` lists commands to `out.log` and returns 0. `help <command>` runs it with
 * `--help`. An unknown name prints to `out.error` and returns 2.
 *
 * @example
 * process.exitCode = await trunk('expressive')(process.argv.slice(2), console);
 */
function trunk(name: string, cwd?: string): Run {
  return async (args, out, invoked = name) => {
    const found = discover(name, cwd || process.cwd(), out);
    let [command, ...rest] = args;

    if (command == 'help' && rest.length) {
      command = rest[0];
      rest = [...rest.slice(1), '--help'];
    }

    if (!command || command == 'help' || command == '--help' || command == '-h') {
      out.log(overview(invoked, found));
      return 0;
    }

    const entry = found.commands.get(command);

    if (entry) {
      const { default: run } = (await import(pathToFileURL(entry.module).href)) as { default: Run };

      return run(rest, out, `${invoked} ${command}`);
    }

    const offer = found.suggested.get(command);

    out.error(
      offer
        ? `"${invoked} ${command}" is not installed - ${found.install} ${offer.package}`
        : `Unknown command "${command}". Run "${invoked} help" for a list.`
    );

    return 2;
  };
}

export { trunk };
export type { Output, Run };

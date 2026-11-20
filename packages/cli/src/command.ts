import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Model } from '@expressive/mvc';

import { help, usage } from './help';
import { cmd, SPECS, type Spec, type Target } from './input';
import { kebab, Reader, Usage } from './parse';
import { described, discover, install, owner, peer, unscoped } from './peer';

/** Where a command writes - `console`, or a test double. */
type Output = Pick<Console, 'log' | 'error'>;

/**
 * Argv after the command name in, exit code out - what {@link command} returns.
 *
 * `name` is the invoked command path, such as `"expressive sql"`, for help text.
 */
type Run = (args: string[], out: Output, name?: string) => Promise<number>;

/** Where a bin's default export carries its runner, for a root on any copy of this package. */
const RUNNER = Symbol.for('@expressive/cli');

const FAMILY = new WeakSet<Function>();

const own = (Type: unknown): string | undefined =>
  typeof Type == 'function' && Object.hasOwn(Type, 'help') ? (Type as any).help : undefined;

class Help extends Error {}

class Absent extends Error {}

class Hand {
  constructor(readonly run: Run) {}
}

class Delegate extends Error {
  constructor(
    readonly run: Run,
    readonly argv: string[],
    readonly name: string
  ) {
    super();
  }
}

class Miss extends Error {
  constructor(
    readonly loader: () => Promise<unknown>,
    readonly cache: Map<string, Model.Type | Hand>,
    readonly key: string
  ) {
    super();
  }
}

/**
 * Turn a Model class into a command - argv in, exit code out.
 *
 * Its `arg`, `args`, `flag`, `opt` and `list` fields are filled from argv before `new()`. A `sub`
 * named in argv is created in turn - every class on the routed path, outermost first, each filled
 * before any `new()` runs. Models held in plain fields activate earlier, before argv is read. Once
 * every class on the path is ready, the last one's `run()` is awaited, then the path is destroyed.
 *
 * A usage error prints to `out.error` and returns 2. `--help`, `-h`, `help` in place of a command, or a
 * group run alone prints help for the path and returns 0. `run` returning `undefined` or `true` gives 0, `false` 1, a number itself; anything else
 * prints to `out.log` and gives 0. A throw, or a failed async `new()`, prints its message and gives 1.
 * The command name in help is `name` if given, else the class name in kebab case.
 *
 * @example
 * export default command(Lint);
 */
function command(Root: Model.Type): Run {
  const name = kebab(Root.name).replace(/^-/, '');

  const load = (target: Target, path: string) => {
    if (target.lazy) return target.lazy;

    const pkg = target.peer!;

    return async () => {
      const file = peer(pkg, name);

      if (!file) throw new Absent(`"${path}" is not installed - ${install(pkg)}`);

      return import(pathToFileURL(file).href);
    };
  };
  const loaded = new Map<Function, Map<string, Model.Type | Hand>>();

  const bin = async (pkg: string) => {
    const file = peer(pkg, name);

    return file && (await import(pathToFileURL(file).href)).default;
  };

  const resolve = async (spec: Spec): Promise<[Spec, number]> => {
    const target = spec.target as Target;
    let Type: any = target.from;
    let help = spec.config.help;

    try {
      if (!Type && help === undefined)
        Type = target.lazy ? (await target.lazy()).default : target.peer && (await bin(target.peer));
    } catch (error) {
      help = `(failed to load: ${error instanceof Error ? error.message : error})`;
    }

    help ??= own(Type) ?? (target.peer && described(target.peer));

    return [{ ...spec, config: { ...spec.config, help } }, Type?.[RUNNER]?.priority ?? 0];
  };

  return async (argv: string[], out: Output, invoked = name) => {
    for (;;) {
      const reader = new Reader(argv, process.cwd());
      const path: Model[] = [];
      let run!: () => unknown;
      let root: Model | undefined;
      let about = own(Root);

      const enter = (named: string) =>
        function (this: Model): any {
          const specs = SPECS.get(this) || [];

          path.push(this);

          const step = reader.enter(specs, named, this.constructor.name);

          if (!step) {
            if (reader.help) throw new Help();

            if ('run' in this) {
              finish();
              run = () => (this as Model & { run(): unknown }).run();
              return;
            }

            if (!specs.some((spec) => spec.kind == 'cmd'))
              throw new TypeError(`${this.constructor.name} has no run() method.`);

            const [extra] = reader.levels.at(-1)!.operands;

            if (extra === undefined) throw new Help();

            throw new Usage(reader.ended ? `Unexpected argument "${extra}".` : `Unknown command "${extra}".`);
          }

          const target = step.target as Target;
          const child = kebab(step.key);

          about = step.config.help;

          if (!target.run) {
            const owner = this.constructor;
            const cache = loaded.get(owner) || loaded.set(owner, new Map()).get(owner)!;
            const Type = target.from || cache.get(step.key);
            const named = `${reader.levels.map((level) => level.name).join(' ')} ${child}`;

            if (!Type) throw new Miss(load(target, named), cache, step.key);

            about ??= own(Type);

            if (Type instanceof Hand) throw new Delegate(Type.run, [...reader.rest(), ...(reader.help ? ['--help'] : [])], named);

            return { [step.key]: new Type(enter(child)) };
          }

          reader.proceed(child);
          finish();
          run = () => target.run!.call(this);

          return { [step.key]: true };
        };

      const finish = () => {
        const values = reader.finish();

        if (values === true) throw new Help();

        path.forEach((level, index) => Object.assign(level, values[index]));
      };

      const shown = () => {
        const names = reader.levels.map((level) => level.name).join(' ');
        const specs = reader.levels.map((level) =>
          level.inline ? level.specs.filter((spec) => spec.kind != 'cmd') : level.specs
        );

        return [names, specs, 'run' in path.at(-1)!, about] as const;
      };

      const listed = async () => {
        const [names, specs, runs, shownAbout] = shown();
        const leaf = specs.length - 1;
        const rows = await Promise.all(
          specs[leaf].map((spec) => (spec.kind == 'cmd' ? resolve(spec) : ([spec, 0] as [Spec, number])))
        );

        if (FAMILY.has(path[leaf].constructor)) rows.sort(([a, p], [b, q]) => q - p || a.key.localeCompare(b.key));

        specs[leaf] = rows.map(([spec]) => spec);

        return [names, specs, runs, shownAbout] as const;
      };

      const quiet = Model.on({
        catch(error, kind) {
          return kind == 'setup' && path.includes(this) ? undefined : error;
        }
      });

      try {
        root = Root.new(enter(invoked));

        for (const level of path) await level.get(() => {});

        const result = await run();

        if (result === undefined || result === true) return 0;
        if (result === false) return 1;
        if (typeof result == 'number') return result;

        out.log(result);
        return 0;
      } catch (error) {
        if (error instanceof Miss) {
          try {
            const Type = ((await error.loader()) as { default?: Model.Type } | undefined)?.default;
            const runner = (Type as any)?.[RUNNER]?.run;

            if (typeof runner == 'function') {
              error.cache.set(error.key, new Hand(runner));
              continue;
            }

            if (!(Type?.prototype instanceof Model))
              throw new TypeError(`Command "${kebab(error.key)}" did not load a Model class.`);

            error.cache.set(error.key, Type);
            continue;
          } catch (failed) {
            error = failed;
          }
        }

        if (error instanceof Delegate) return error.run(error.argv, out, error.name);

        if (error instanceof Help) {
          out.log(help(...(await listed())));
          return 0;
        }

        if (error instanceof Absent) {
          out.error(error.message);
          return 2;
        }

        if (error instanceof Usage) {
          const [names, specs, runs] = shown();

          out.error(`${error.message}\n${usage(names, specs, runs)}`);
          return 2;
        }

        out.error(error instanceof Error ? error.message : String(error));
        return 1;
      } finally {
        quiet();
        root?.set(null);
      }
    }
  };
}

/** A command shared by several packages - see {@link main}. */
interface Family {
  /** Root command name - the `bin` entry every member ships. */
  as: string;
  /** Package names to look for - each passing one with an `as` bin becomes a command. Default: own scope. */
  filter?: RegExp;
  /** Order in the root's listing - higher first, default 0, ties alphabetical. */
  priority?: number;
}

function family(meta: { url: string }, Type: Model.Type, { as, filter }: Family) {
  const self = owner(fileURLToPath(meta.url));
  const scope = self?.match(/^@[^/]+\//)?.[0];
  const targets: Record<string, Target> = {
    [self ? unscoped(self) : kebab(Type.name).replace(/^-/, '')]: { from: Type }
  };

  filter ??= scope ? new RegExp('^' + scope.replace('.', '\\.')) : undefined;

  if (filter) for (const [key, pkg] of discover(filter, as)) if (!(key in targets)) targets[key] = { peer: pkg };

  const Root = class extends Model {
    constructor(...args: any[]) {
      super(...args);

      for (const key in targets) (this as any)[key] = cmd(targets[key] as any);
    }
  };

  FAMILY.add(Root);

  return Object.defineProperty(Root, 'name', { value: as });
}

/**
 * Make `Type` a bin's command - run it when the calling module is the entry, and return it to export.
 *
 * The returned class carries its runner, so a root of any copy of this package that imports the bin
 * hands it argv instead of parsing with its own inputs. Imported, nothing runs. Run as the entry,
 * argv sets `process.exitCode`. Entry means `import.meta.main` where the runtime has it, else the
 * module's real path equals the script's.
 *
 * With `as`, the entry is a root named `as` instead: `Type` as a command named after its package
 * (scope dropped), plus every installed package passing `filter` - default its own scope - whose `bin`
 * has an `as` entry. Running one imports only its bin. The root's help imports every bin, lists each
 * by its class's static `help` (else its package's `description`), and orders them by `priority`.
 *
 * @example
 * export default main(import.meta, Env, { as: 'expressive' });
 */
function main<T extends Model.Type>(meta: { url: string; main?: boolean }, Type: T, shared?: Family): T {
  const script = process.argv[1];
  const entry =
    meta.main ?? (!!script && existsSync(script) && realpathSync(fileURLToPath(meta.url)) == realpathSync(script));
  const run = command(Type);

  Object.defineProperty(Type, RUNNER, { value: { run, priority: shared?.priority }, configurable: true });

  if (entry)
    (shared ? command(family(meta, Type, shared)) : run)(process.argv.slice(2), console).then((code) => {
      process.exitCode = code;
    });

  return Type;
}

export { command, main };
export type { Family, Output, Run };

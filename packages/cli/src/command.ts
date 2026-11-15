import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Model } from '@expressive/mvc';

import { help, usage } from './help';
import { SPECS, type Target } from './input';
import { kebab, Reader, Usage } from './parse';
import { install, peer } from './peer';

/** Where a command writes - `console`, or a test double. */
type Output = Pick<Console, 'log' | 'error'>;

/**
 * Argv after the command name in, exit code out - what {@link command} returns.
 *
 * `name` is the invoked command path, such as `"expressive sql"`, for help text.
 */
type Run = (args: string[], out: Output, name?: string) => Promise<number>;

class Help extends Error {}

class Absent extends Error {}

class Miss extends Error {
  constructor(
    readonly loader: () => Promise<unknown>,
    readonly cache: Map<string, Model.Type>,
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
  const loaded = new Map<Function, Map<string, Model.Type>>();

  return async (argv: string[], out: Output, invoked = name) => {
    for (;;) {
      const reader = new Reader(argv, process.cwd());
      const path: Model[] = [];
      let run!: () => unknown;
      let root: Model | undefined;
      let about: string | undefined;

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

            if (!Type) throw new Miss(load(target, `${reader.levels.map((level) => level.name).join(' ')} ${child}`), cache, step.key);

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

            if (!(Type?.prototype instanceof Model))
              throw new TypeError(`Command "${kebab(error.key)}" did not load a Model class.`);

            error.cache.set(error.key, Type);
            continue;
          } catch (failed) {
            error = failed;
          }
        }

        if (error instanceof Help) {
          out.log(help(...shown()));
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

/**
 * Run `Root` as the process's command - only when the calling module is the entry being executed.
 *
 * Imported instead, as a `peer` or by a test, it does nothing. Sets `process.exitCode` from argv. Uses
 * `import.meta.main` where the runtime has it, else compares the module's real path to the script's.
 *
 * @example
 * main(import.meta, Expressive);
 */
async function main(meta: { url: string; main?: boolean }, Root: Model.Type) {
  const script = process.argv[1];
  const entry =
    meta.main ?? (!!script && existsSync(script) && realpathSync(fileURLToPath(meta.url)) == realpathSync(script));

  if (entry) process.exitCode = await command(Root)(process.argv.slice(2), console);
}

export { command, main };
export type { Output, Run };

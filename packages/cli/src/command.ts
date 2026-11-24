import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Console } from 'node:console';
import { Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import { Model } from '@expressive/mvc';

import { help, inputJson, scope, usage } from './help';
import { cmd, sample, SPECS, type Spec, type Target } from './input';
import { kebab, Reader, Usage } from './parse';
import { described, discover, install, locate, owner, peer, unscoped } from './peer';

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

const own = (Type: unknown, key: PropertyKey): any =>
  typeof Type == 'function' && Object.hasOwn(Type, key) ? (Type as any)[key] : undefined;

const helpOf = (Type: unknown): string | undefined => {
  const help = own(Type, 'help');

  return typeof help == 'string' ? help : undefined;
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

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

interface Level {
  Type: Model.Type;
  specs: Spec[];
  runs: boolean;
  key?: string;
  inline?: boolean;
}

interface Node {
  command: string;
  help?: string;
  usage?: string;
  runs?: boolean;
  installed?: false;
  error?: string;
  inputs?: object[];
  commands?: Node[];
}

interface Outcome {
  code: number;
  help?: string | Node;
  error?: { kind: 'usage' | 'absent' | 'error'; message: string; usage?: string };
  delegate?: (out: Output) => Promise<number>;
}

/** Run a runner that was handed `--json` - its envelope, else one wrapping what it printed. */
async function envelope(run: (out: Output) => Promise<number>) {
  const lines: string[] = [];
  const push = (line: unknown) => void lines.push(String(line));
  const code = await run({ log: push, error: push });
  const text = lines.join('\n');

  try {
    const reply = JSON.parse(text);

    if (typeof reply.code == 'number') return reply;
  } catch {}

  return { code, stdout: text && text + '\n', stderr: '' };
}

function capture() {
  const text = { stdout: '', stderr: '' };
  const undo: (() => void)[] = [];

  const patch = (target: any, key: string, value: unknown) => {
    const before = Object.getOwnPropertyDescriptor(target, key);

    Object.defineProperty(target, key, { value, configurable: true, writable: true });
    undo.push(() => (before ? Object.defineProperty(target, key, before) : delete target[key]));
  };

  const sink = (stream: keyof typeof text) => {
    const decoder = new StringDecoder();

    return (chunk: string | Uint8Array, ...rest: unknown[]) => {
      text[stream] += typeof chunk == 'string' ? chunk : decoder.write(Buffer.from(chunk));
      (rest.find((arg) => typeof arg == 'function') as Function | undefined)?.();
      return true;
    };
  };

  const writable = (stream: keyof typeof text) => {
    const write = sink(stream);

    return new Writable({ write: (chunk, _, done) => (write(chunk), done()) });
  };
  const local = new Console(writable('stdout'), writable('stderr'));

  for (const stream of ['stdout', 'stderr'] as const) {
    patch(process[stream], 'isTTY', false);
    patch(process[stream], 'write', sink(stream));
  }

  for (const [key, value] of Object.entries(local).filter(([, value]) => typeof value == 'function')) patch(console, key, value.bind(local));

  return [text, () => undo.reverse().forEach((restore) => restore())] as const;
}

/**
 * Turn a Model class into a command - argv in, exit code out.
 *
 * Argv is routed against bare instances of each class on the path - constructed, never activated - so
 * help and usage errors start nothing. Then the path is built, outermost first, each class filled from
 * argv before any `new()` runs. Once every class is ready, the last one's `run()` is awaited, then the
 * path is destroyed.
 *
 * `run` returns `undefined` or `true` for 0, `false` for 1, or an exit code - anything else is an error,
 * so a command prints its own output. A usage error prints to `out.error` and returns 2. `--help`, `-h`,
 * `help` in place of a command, or a group run alone prints help for the path and returns 0. A throw, or
 * a failed async `new()`, prints its message and gives 1. The command name in help is `name` if given,
 * else the class name in kebab case.
 *
 * `--json`, reserved on every class, prints one line instead - `{ code, stdout, stderr }`, plus `error`
 * on failure and `help` for help. Output written while running is captured into it, and `isTTY` reads
 * false meanwhile. Capture is process-wide - don't run `--json` calls concurrently. Help under `--json`
 * describes the routed command and every command below it, importing `lazy` and `peer` modules.
 *
 * @example
 * export default command(Lint);
 */
function command(Root: Model.Type): Run {
  return build(Root, kebab(Root.name).replace(/^-/, ''));
}

function build(Root: Model.Type, name: string): Run {
  const loaded = new Map<Function, Map<string, Model.Type | Hand>>();

  const bin = async (pkg: string) => {
    const file = peer(pkg, name);

    return file && (await import(pathToFileURL(file).href)).default;
  };

  const load = async (owner: Function, key: string, target: Target, path: string) => {
    const cache = loaded.get(owner) || loaded.set(owner, new Map()).get(owner)!;
    let Type: any = target.from || cache.get(key);

    if (Type) return Type as Model.Type | Hand;

    if (target.peer && !locate(target.peer)) throw new Absent(`"${path}" is not installed - ${install(target.peer)}`);

    Type = target.lazy ? (await target.lazy()).default : await bin(target.peer!);

    const runner = own(Type, RUNNER)?.run;

    if (typeof runner == 'function' && FAMILY.has(owner)) Type = new Hand(runner);
    else if (!(Type?.prototype instanceof Model)) throw new TypeError(`Command "${kebab(key)}" did not load a Model class.`);

    cache.set(key, Type);

    return Type as Model.Type | Hand;
  };

  const resolve = async (spec: Spec): Promise<[Spec, number]> => {
    const target = spec.target as Target;
    let Type: any = target.from;
    let help = spec.config.help;

    try {
      if (!Type && help === undefined)
        Type = target.lazy ? (await target.lazy()).default : target.peer && (await bin(target.peer));
    } catch (error) {
      help = `(failed to load: ${message(error)})`;
    }

    help ??= helpOf(Type) ?? (target.peer && described(target.peer));

    return [{ ...spec, config: { ...spec.config, help } }, own(Type, RUNNER)?.priority ?? 0];
  };

  const listing = async (Type: Function, specs: Spec[]) => {
    const rows = await Promise.all(specs.map((spec) => (spec.kind == 'cmd' ? resolve(spec) : ([spec, 0] as [Spec, number]))));

    if (FAMILY.has(Type)) rows.sort(([a, p], [b, q]) => q - p || a.key.localeCompare(b.key));

    return rows.map(([spec]) => spec);
  };

  const describe = async (spec: Spec, owner: Function, path: string, seen: Set<Function>): Promise<Node> => {
    const target = spec.target as Target;
    const node: Node = { command: `${path} ${kebab(spec.key)}`, help: spec.config.help };

    if (target.run) return { ...node, runs: true };

    if (target.peer && !locate(target.peer)) return { ...node, installed: false };

    try {
      const Type = await load(owner, spec.key, target, node.command);

      if (Type instanceof Hand) {
        const reply = await envelope((out) => Type.run(['--help', '--json'], out, node.command));

        return reply?.help ? { ...reply.help, help: node.help } : { ...node, error: reply?.error?.message ?? 'no --json support' };
      }

      return seen.has(Type) ? node : await tree(await sample(Type), node.command, [], seen, node.help);
    } catch (error) {
      return { ...node, error: message(error) };
    }
  };

  const tree = async (level: Level, path: string, above: Spec[][], seen: Set<Function>, about?: string): Promise<Node> => {
    const specs = [...above, level.specs];
    const { operands, commands, options } = scope(specs);
    const inner = new Set(seen).add(level.Type);
    const listed = await listing(level.Type, commands);

    return {
      command: path,
      help: about,
      usage: usage(path, specs, level.runs),
      runs: level.runs,
      inputs: [...operands, ...options].map(inputJson),
      commands: await listed.reduce(
        async (nodes, spec) => [...(await nodes), await describe(spec, level.Type, path, inner)],
        Promise.resolve([] as Node[])
      )
    };
  };

  const execute = async (argv: string[], invoked: string, json: boolean): Promise<Outcome> => {
    const reader = new Reader(argv, process.cwd());
    const levels: Level[] = [];
    const path: Model[] = [];
    let about = helpOf(Root);
    let root: Model | undefined;

    const shown = () => {
      const names = reader.levels.map((level) => level.name).join(' ');
      const specs = reader.levels.map((level) => (level.inline ? level.specs.filter((spec) => spec.kind != 'cmd') : level.specs));

      return [names, specs, !!levels.at(-1)?.runs] as const;
    };

    const route = async () => {
      for (let Type = Root, named = invoked; ; ) {
        const level: Level = await sample(Type);

        levels.push(level);

        const step = reader.enter(level.specs, named, Type.name);

        if (!step) {
          if (reader.help) throw new Help();

          if (level.runs) return;

          if (!level.specs.some((spec) => spec.kind == 'cmd')) throw new TypeError(`${Type.name} has no run() method.`);

          const [extra] = reader.levels.at(-1)!.operands;

          if (extra === undefined) throw new Help();

          throw new Usage(reader.ended ? `Unexpected argument "${extra}".` : `Unknown command "${extra}".`);
        }

        const target = step.target as Target;
        const child = kebab(step.key);

        about = step.config.help;
        level.key = step.key;

        if (target.run) {
          reader.proceed(child);
          level.inline = true;
          return;
        }

        const path = `${reader.levels.map((level) => level.name).join(' ')} ${child}`;
        const Next = await load(Type, step.key, target, path);

        about ??= helpOf(Next);

        if (Next instanceof Hand) {
          const flags = [...(json ? ['--json'] : []), ...(reader.help ? ['--help'] : [])];

          throw new Delegate(Next.run, [...flags, ...reader.rest()], path);
        }

        Type = Next;
        named = child;
      }
    };

    const assign = (index: number) =>
      function (this: Model) {
        const { key } = levels[index];
        const Next = levels[index + 1]?.Type;

        path.push(this);

        return key ? { ...values[index], [key]: Next ? new Next(assign(index + 1)) : true } : values[index];
      };

    const quiet = Model.on({
      catch(error, kind) {
        return kind == 'setup' && path.includes(this) ? undefined : error;
      }
    });

    let values: Record<string, unknown>[];

    try {
      await route();

      const read = reader.finish();

      if (read === true) throw new Help();

      values = read;
      root = Root.new(assign(0));

      for (const level of path) await level.get(() => {});

      const { key, inline } = levels.at(-1)!;
      const target = path.at(-1) as Model & { run(): unknown };
      const run = inline ? SPECS.get(target)!.find((spec) => spec.key == key)!.target!.run! : target.run;
      const result = await run.call(target);

      if (result === undefined || result === true) return { code: 0 };
      if (result === false) return { code: 1 };
      if (typeof result == 'number') return { code: result };

      throw new TypeError(`${target.constructor.name} run() returned ${result === null ? 'null' : typeof result} - print output and return a status.`);
    } catch (error) {
      if (error instanceof Delegate) return { code: 0, delegate: (out) => error.run(error.argv, out, error.name) };

      if (error instanceof Help) {
        const [names, specs, runs] = shown();
        const leaf = levels.at(-1)!;

        if (json) return { code: 0, help: await tree({ ...leaf, specs: specs.at(-1)! }, names, specs.slice(0, -1), new Set(), about) };

        specs[specs.length - 1] = await listing(leaf.Type, specs.at(-1)!);

        return { code: 0, help: help(names, specs, runs, about) };
      }

      if (error instanceof Absent) return { code: 2, error: { kind: 'absent', message: error.message } };

      if (error instanceof Usage) return { code: 2, error: { kind: 'usage', message: error.message, usage: usage(...shown()) } };

      return { code: 1, error: { kind: 'error', message: message(error) } };
    } finally {
      quiet();
      root?.set(null);
    }
  };

  return async (argv: string[], out: Output, invoked = name) => {
    const end = argv.includes('--') ? argv.indexOf('--') : argv.length;
    const json = argv.slice(0, end).includes('--json');

    if (!json) {
      const { code, help, error, delegate } = await execute(argv, invoked, false);

      if (delegate) return delegate(out);
      if (help) out.log(help);
      if (error) out.error(error.usage ? `${error.message}\n${error.usage}` : error.message);

      return code;
    }

    const [text, restore] = capture();
    let outcome: Outcome;

    try {
      outcome = await execute([...argv.slice(0, end).filter((arg) => arg != '--json'), ...argv.slice(end)], invoked, true);
    } finally {
      restore();
    }

    const { delegate, code, ...rest } = outcome;

    if (delegate) {
      const reply = await envelope(delegate);

      out.log(JSON.stringify(reply));

      return reply.code;
    }

    out.log(JSON.stringify({ code, ...text, ...rest }));

    return code;
  };
}

/** A command shared by several packages - see {@link main}. */
interface Family {
  /** Root command name - the `bin` entry every member ships. */
  as: string;
  /** Package names to look for - matches with an `as` bin become commands. Default: own scope. */
  filter?: RegExp;
  /** Order in the root's listing - higher first, default 0, ties alphabetical. */
  priority?: number;
}

function family(meta: { url: string }, Type: Model.Type, { as, filter }: Family) {
  const self = owner(fileURLToPath(meta.url));
  const scope = self?.match(/^@[^/]+\//)?.[0];
  const targets = new Map<string, Target>([[self ? unscoped(self) : kebab(Type.name).replace(/^-/, ''), { from: Type }]]);

  filter ??= scope ? new RegExp('^' + scope.replace(/\./g, '\\.')) : undefined;

  if (filter)
    for (const [key, pkg] of discover(filter, as))
      if (!targets.has(key) && key != 'help' && !(key in Model.prototype)) targets.set(key, { peer: pkg });

  const Root = class extends Model {
    constructor(...args: any[]) {
      super(...args);

      for (const [key, target] of targets) (this as any)[key] = cmd(target as any);
    }
  };

  FAMILY.add(Root);

  return Object.defineProperty(Root, 'name', { value: as });
}

/**
 * Make `Type` a bin's command - run it when the calling module is the entry, and return it to export.
 *
 * The returned class carries its runner, so a family root of any copy of this package that imports the
 * bin hands it argv instead of parsing with its own inputs. Imported, nothing runs. Run as the entry,
 * argv sets `process.exitCode`. Entry means `import.meta.main` where the runtime has it, else the
 * module's real path equals the script's.
 *
 * With `as`, the entry is a root named `as` instead: `Type` as a command named after its package
 * (scope dropped), plus every installed package passing `filter` - default its own scope - whose `bin`
 * has an `as` entry. Running one imports only its bin. The root's help imports every bin, lists each
 * by its class's static `help` (else its package's `description`), and orders them by `priority`. A
 * package named `help` or after a Model member is skipped.
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
    (shared ? build(family(meta, Type, shared), shared.as) : run)(process.argv.slice(2), console).then((code) => {
      process.exitCode = code;
    });

  return Type;
}

export { command, main };
export type { Family, Output, Run };

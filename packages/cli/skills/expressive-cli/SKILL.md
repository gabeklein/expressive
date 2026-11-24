---
name: expressive-cli
description: Commands from Model classes (@expressive/cli) - argv onto fields, subcommands, help, and a command shared by several packages. Use when writing a CLI, adding a subcommand, or shipping packages that contribute to one command.
---

# @expressive/cli

A command is a Model class. Input fields fill from argv before `new()`; `run()` is the command. `command(Root)` returns a `Run` - argv in, exit code out.

```ts
import { arg, cmd, command, flag, main, opt } from "@expressive/cli";
import { Model } from "@expressive/mvc";

class Sync extends Model {
  entry = arg({ type: "file", exists: true, required: true, help: "module that creates connections" });
  force = flag({ short: "f", help: "rebuild drifted columns" });
  port = opt({ short: "p", default: 5432 });

  async run() { /* ... */ }        // undefined/true → 0, false → 1, number → itself; print output, don't return it
}

class Sql extends Model {
  sync = cmd({ from: Sync, help: "create missing tables" });
}

main(import.meta, Sql);            // runs only when this file is the process entry
```

Inputs: `arg` (next operand), `args` (remaining operands), `flag` (boolean, `--no-x` negates), `opt` (one value), `list` (repeated, `split` divides). Each takes `help`; value inputs take `type` (`string`, `number`, `file`, `dir`, `path`), `parse`, `valid`, `default`, `required`. `file`/`dir`/`path` resolve against the working directory; `exists` checks them.

## Subcommands

`cmd()` takes one object with exactly one of:

| Key | Command | `help` |
|---|---|---|
| `from: Class` | a class in hand | optional |
| `lazy: () => import("./sync")` | a module of this package, default-exporting the class, imported when routed to | optional |
| `peer: "@scope/pkg"` | another package's command - its `bin` named after the root command | optional |
| `run() { ... }` | inline, called on the parent, fills the parent's `arg`s | optional |

The field holds the routed child (`true` for inline), else `undefined`. Options of every class on the path work anywhere after their owner's name; only the last class takes operands. A class with commands and no `run` is a group.

Help: `--help`, `-h`, `help` in place of a command (`sql help sync`), or a group run alone prints help and exits 0. Usage errors exit 2, a throw exits 1.

A class's own `static help` describes it - in its parent's listing and atop its own help. `cmd({ help })` overrides it. Without either, listing a `lazy` or `peer` command imports its module to read the static, so keep command modules cheap to import - heavy dependencies go inside `run()`. A missing `peer` lists as `(not installed)`; routing to it exits 2 with an install command.

Routing reads each class from a bare instance, never activated, so help and usage errors start nothing. A class on the path is therefore constructed twice per run - keep construction free of side effects; work goes in `new()` or `run()`. A field calling `X.new()` starts even for help, and a `catch` handler on a command's class sees `unused` for the bare instances. `parse` and `valid` run against that bare instance, so they see only the value - don't read `this`.

## Scripts and agents

`--json`, reserved on every command, prints one line instead of text:

```json
{ "code": 0, "stdout": "PORT  4 chars  .env:1\n", "stderr": "" }
```

Output written through `console` or `process.stdout`/`stderr` is captured into it; `isTTY` reads false meanwhile, so color and spinner libraries back off. A child process with inherited stdio and bun's `console.write` bypass capture - pipe output through `process.stdout` instead - and `process.exit()` skips the envelope. Failures add `error: { kind, message }` - `kind` is `usage` (with `usage`), `absent` or `error`.

`--help --json` puts `help` in the envelope: the routed command and every command below it, each input with its argv spelling and a JSON Schema for its value. The routed command lists options inherited from its parents; nodes below it list only their own. It imports every `lazy` and `peer` module in that subtree.

## One command across packages

Packages in one scope share a bin name - each ships its own command and finds the rest.

```ts
// @acme/db  dist/bin.js  ←  package.json "bin": { "acme": "dist/bin.js" }
import { cmd, main } from "@expressive/cli";
import { Model } from "@expressive/mvc";

class Db extends Model {
  static help = "migrate and seed";

  migrate = cmd({ lazy: () => import("./migrate") });
}

export default main(import.meta, Db, { as: "acme" });
```

Whichever package the package manager links as `acme` is the root: its own command, named after its package without the scope (`db`), plus every installed package of the same scope whose `bin` has an `acme` entry. `filter: /^.../` matches other package names - keep it to one scope, or two packages may claim one name. Packages are searched from the working directory upward, then beside the running script - npm, bun and pnpm layouts; not Yarn PnP.

- `acme db migrate` imports only `@acme/db`'s bin and hands it `migrate` - each package parses with its own copy of `@expressive/cli`, so versions may differ. Only a root made by `main` hands off; a `cmd({ peer })` field routes in its parent's process, under the parent's options.
- `acme --help` imports every member's bin and lists each by its `static help`, else its `package.json` `description`. Order: `priority` from each `main` config, higher first, then alphabetical.
- Imported, `main` runs nothing - it returns the class with its runner attached, for the root to call. Run as the entry without a third argument, the class alone is the command.
- A member whose bin predates this contract is routed in the root's process, which works only when both share one copy of `@expressive/cli` - release a family's packages together.

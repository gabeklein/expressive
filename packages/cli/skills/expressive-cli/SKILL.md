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

  async run() { /* ... */ }        // undefined/true → 0, false → 1, number → itself
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
| `lazy: () => import("./sync")` | a module of this package, default-exporting the class, imported when routed to | required |
| `peer: "@scope/pkg"` | another package's command - see below | required |
| `run() { ... }` | inline, called on the parent, fills the parent's `arg`s | optional |

The field holds the routed child (`true` for inline), else `undefined`. Options of every class on the path work anywhere after their owner's name; only the last class takes operands. A class with commands and no `run` is a group.

Help: `--help`, `-h`, `help` in place of a command (`sql help sync`), or a group run alone prints help and exits 0. Usage errors exit 2, a throw exits 1.

Keep command modules cheap to import - import heavy dependencies inside `run()`. Help lists `lazy` and `peer` commands from their `help` alone.

## One command across packages

Several packages can share a bin name without clobbering each other: each ships the same root class listing the others as `peer`s, and its own bin under that name.

```ts
// @acme/db  dist/bin.js  ←  package.json "bin": { "acme": "dist/bin.js" }
import { cmd, main } from "@expressive/cli";
import { Model } from "@expressive/mvc";

export default class Db extends Model {
  migrate = cmd({ lazy: () => import("./migrate"), help: "apply migrations" });
}

class Acme extends Model {
  db = cmd({ peer: "@acme/db", help: "migrate and seed" });
  deploy = cmd({ peer: "@acme/deploy", help: "ship to production" });
}

main(import.meta, Acme);
```

Whichever package the package manager links as `acme`, `acme db` and `acme deploy` both work. A `peer` resolves from the working directory upward, then beside the running script; its `bin` entry named after the root command (`acme`, the root class in kebab case) is imported and its default export routed to. Not installed, help marks it `(not installed)` and running it exits 2 with an install command for the project's package manager.

Each package keeps its own copy of the root class - keeping them in step is the family's job.

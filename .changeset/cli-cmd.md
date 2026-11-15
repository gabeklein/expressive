---
"@expressive/cli": minor
---

**`cmd()` replaces `sub()`** and takes one object with exactly one of `from` (a class), `lazy` (an import of a module default-exporting the class), `peer` (another package) or `run` (inline). `help` is required for `lazy` and `peer`.

**Several packages can share one command.** A `peer` resolves from the working directory and runs the default export of that package's `bin` entry named after the root command; missing, help marks it "not installed" and running it prints an install command. `main(import.meta, Root)` runs a command only when its module is the process entry, so a bin can also be imported as a peer.

`help` in place of a command, or a group run alone, prints help and exits 0 - it exited 2. A command's `help` heads its own `--help`, and a list of commands ends with how to get help for one. A `Run` takes the invoked name for help text. The `@expressive/cli/bin` dispatcher is removed.

# @expressive/cli

## 0.2.0

### Minor Changes

- [#725](https://github.com/gabeklein/expressive/pull/725) [`6cabc0b`](https://github.com/gabeklein/expressive/commit/6cabc0bccf7aab2f8b71da382b0fbc2a435fa30c) **`cmd()` replaces `sub()`** and takes one object with exactly one of `from` (a class), `lazy` (an import of a module default-exporting the class), `peer` (another package) or `run` (inline). `help` is required for `lazy` and `peer`.

  **Several packages can share one command.** A `peer` resolves from the working directory and runs the default export of that package's `bin` entry named after the root command; missing, help marks it "not installed" and running it prints an install command. `main(import.meta, Root)` runs a command only when its module is the process entry, so a bin can also be imported as a peer.

  `help` in place of a command, or a group run alone, prints help and exits 0 - it exited 2. A command's `help` heads its own `--help`, and a list of commands ends with how to get help for one. A flag defaulting to `true` is listed as `--no-name`. A `Run` takes the invoked name for help text. The `@expressive/cli/bin` dispatcher is removed.

## 0.1.0

### Minor Changes

- [#704](https://github.com/gabeklein/expressive/pull/704) [`8a5138a`](https://github.com/gabeklein/expressive/commit/8a5138abab19ec9dc3df5277578f93642532a7cc) `sub()` routes subcommands by name - a class, a lazy loader or an inline command. Every class on the path is filled from argv before any `new()`; options may follow any level, and a name shared across levels is one option. `run()` waits for the path to be ready, and usage errors and `--help` abort before `new()`.

### Patch Changes

- Updated dependencies [[`b7be047`](https://github.com/gabeklein/expressive/commit/b7be047c229a1bcaeb7906b660261e2b64edc584)]:
  - @expressive/mvc@0.94.5

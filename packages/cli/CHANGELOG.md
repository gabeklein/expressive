# @expressive/cli

## 0.3.0

### Minor Changes

- [#767](https://github.com/gabeklein/expressive/pull/767) [`7d7714b`](https://github.com/gabeklein/expressive/commit/7d7714bd6fb2e55a0c552ede262ac4c8b60142fc) `main(import.meta, Type, { as })` makes a package a member of a command shared across packages: run as the entry, it roots `as` with its own command plus every installed package of its scope whose `bin` has an `as` entry - `filter` matches other names, `priority` orders the listing. Each member parses with its own copy of `@expressive/cli`. `main` now returns `Type` instead of a promise, for the bin to `export default`. A command class's own `static help` describes it in listings and atop its help; `help` is no longer required on `lazy` and `peer` commands.

## 0.2.3

### Patch Changes

- Updated dependencies [[`340759c`](https://github.com/gabeklein/expressive/commit/340759c8fa3a4b2b6b759e9082f8a731ee338ac2)]:
  - @expressive/mvc@0.97.0

## 0.2.2

### Patch Changes

- Updated dependencies [[`cf2e10b`](https://github.com/gabeklein/expressive/commit/cf2e10bb021364721007bf1102c76a53e8c67f25), [`0360067`](https://github.com/gabeklein/expressive/commit/0360067d50ff09d1cd72efdd5b3ee456151bfdd3), [`6711fd8`](https://github.com/gabeklein/expressive/commit/6711fd88de99b43fbb273fa0c78ebf6c6da7b414)]:
  - @expressive/mvc@0.96.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`b968a6d`](https://github.com/gabeklein/expressive/commit/b968a6d4eac9a3f2b4de09f77ca13941b9ac8294), [`829ff1c`](https://github.com/gabeklein/expressive/commit/829ff1ca06cab12636cd64c25f11805e67f09b4e)]:
  - @expressive/mvc@0.95.0

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

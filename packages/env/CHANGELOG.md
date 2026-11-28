# @expressive/env

## 0.2.1

### Patch Changes

- Updated dependencies [[`5d717d2`](https://github.com/gabeklein/expressive/commit/5d717d2850a5527e15ee58770f3a526b1e5500a9), [`54b60e9`](https://github.com/gabeklein/expressive/commit/54b60e923a827e31b34f88013f0ce05280a2314f), [`bd33e34`](https://github.com/gabeklein/expressive/commit/bd33e34af218dee798dcbca862b1ee8f21754393), [`54b60e9`](https://github.com/gabeklein/expressive/commit/54b60e923a827e31b34f88013f0ce05280a2314f), [`1afeb40`](https://github.com/gabeklein/expressive/commit/1afeb40298921c57a3990a31e6ebdae5630fc152), [`3600c49`](https://github.com/gabeklein/expressive/commit/3600c493cffab48675bc6dbb4d47070a261e9942)]:
  - @expressive/mvc@0.98.0
  - @expressive/cli@0.3.1

## 0.2.0

### Minor Changes

- [#758](https://github.com/gabeklein/expressive/pull/758) [`92dcc2d`](https://github.com/gabeklein/expressive/commit/92dcc2d68a5751d9b344f044c11bab09a01d9bda) `expressive env` alone writes `env.d.ts` and warns of unset keys without failing - a setup step for `prepare` scripts. The Vite plugin no longer creates `env.d.ts` on dev start (it refreshes one that exists), defers to an earlier `env()` in the same config, and drops from a bundle when nothing reads `env`.

  `register()` copies the mode's `.env` files into `process.env` for dependencies that read it - call it before they load, or preload `@expressive/env/register` with `node --import`. Keys already set, and `NODE_ENV`, are left alone.

### Patch Changes

- [#767](https://github.com/gabeklein/expressive/pull/767) [`7d7714b`](https://github.com/gabeklein/expressive/commit/7d7714bd6fb2e55a0c552ede262ac4c8b60142fc) `expressive` finds installed `@expressive/*` commands instead of a hard-coded list - help no longer lists packages that are not installed, and running one is an unknown command rather than an install hint.
- Updated dependencies [[`7d7714b`](https://github.com/gabeklein/expressive/commit/7d7714bd6fb2e55a0c552ede262ac4c8b60142fc)]:
  - @expressive/cli@0.3.0

## 0.1.0

### Minor Changes

- [#736](https://github.com/gabeklein/expressive/pull/736) [`0b6998e`](https://github.com/gabeklein/expressive/commit/0b6998e79f7fc7521bbbacd973733d9ea609ebea) `expressive env` - `sync` writes `env.d.ts` from the `.env` files' key names and comments, `check` fails on unset keys or undeclared types, `list` shows each key's state and `file:line` without values, `read` pipes values, `write` sets `KEY=value` pairs or one from stdin, `unset` removes keys with their doc comments.

- [#735](https://github.com/gabeklein/expressive/pull/735) [`9ab5f91`](https://github.com/gabeklein/expressive/commit/9ab5f91d2112d5debbf69e121551a3acd9d3ebf7) New package: `env` reads the project's `.env` files, layered by mode under `process.env`, without writing `process.env`.

- [#737](https://github.com/gabeklein/expressive/pull/737) [`f0d4c38`](https://github.com/gabeklein/expressive/commit/f0d4c38e9b4ed6c78dc7a9eb0336cd1d0d2e485f) `env()` from `@expressive/env/vite` serves `env` to the client with only `PUBLIC_` keys - `prefix` changes or turns off the rule - and keeps `env.d.ts` current in dev.

### Patch Changes

- Updated dependencies [[`340759c`](https://github.com/gabeklein/expressive/commit/340759c8fa3a4b2b6b759e9082f8a731ee338ac2)]:
  - @expressive/mvc@0.97.0
  - @expressive/cli@0.2.3

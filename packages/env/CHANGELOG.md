# @expressive/env

## 0.1.0

### Minor Changes

- [#736](https://github.com/gabeklein/expressive/pull/736) [`0b6998e`](https://github.com/gabeklein/expressive/commit/0b6998e79f7fc7521bbbacd973733d9ea609ebea) `expressive env` - `sync` writes `env.d.ts` from the `.env` files' key names and comments, `check` fails on unset keys or undeclared types, `list` shows each key's state and `file:line` without values, `read` pipes values, `write` sets `KEY=value` pairs or one from stdin, `unset` removes keys with their doc comments.

- [#735](https://github.com/gabeklein/expressive/pull/735) [`9ab5f91`](https://github.com/gabeklein/expressive/commit/9ab5f91d2112d5debbf69e121551a3acd9d3ebf7) New package: `env` reads the project's `.env` files, layered by mode under `process.env`, without writing `process.env`.

- [#737](https://github.com/gabeklein/expressive/pull/737) [`f0d4c38`](https://github.com/gabeklein/expressive/commit/f0d4c38e9b4ed6c78dc7a9eb0336cd1d0d2e485f) `env()` from `@expressive/env/vite` serves `env` to the client with only `PUBLIC_` keys - `prefix` changes or turns off the rule - and keeps `env.d.ts` current in dev.

### Patch Changes

- Updated dependencies [[`340759c`](https://github.com/gabeklein/expressive/commit/340759c8fa3a4b2b6b759e9082f8a731ee338ac2)]:
  - @expressive/mvc@0.97.0
  - @expressive/cli@0.2.3

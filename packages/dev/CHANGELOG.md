# @expressive/dev

## 0.4.0

### Minor Changes

- [#777](https://github.com/gabeklein/expressive/pull/777) [`fd081ec`](https://github.com/gabeklein/expressive/commit/fd081eca6f5d898eb52da67c480f9fd657270f94) `config({ around(next, { request, env, ctx }) })` wraps every remote call and the app's `fetch` on each host - Node, the `fetch` target and dev - for per-request context such as a database session: `around: next => db.session(next)`.

- [#773](https://github.com/gabeklein/expressive/pull/773) [`5b5c802`](https://github.com/gabeklein/expressive/commit/5b5c8022f8d653aa35b2141e024d03c54a470971) Prerendering skips by page, not by folder. A `remote.ts` or `remote/` no longer leaves its folder and everything below it unrendered: every page renders at build, and remote stubs stop at the server there - calling a remote function or twin method, or reading a twin's values, aborts that page's render and leaves that page to the browser. A remote at the root of `app/`, shared by many screens, no longer disables prerendering for static pages beside it, and a seat no longer blocks pages under it that never read it. The build never runs server code.

- [#774](https://github.com/gabeklein/expressive/pull/774) [`54a571e`](https://github.com/gabeklein/expressive/commit/54a571e8a6902e0baedd38fac03239024fb92b46) `config({ fetch })` in `index.ts` gives the app its own routes, after remote calls and before static files, in the request's scope - on Node, in a build and in `expressive dev`. `config({ target: "fetch" })` builds `dist/server/index.js` as `export default { fetch }` with every dependency bundled, for a host that calls a module's `fetch`: remote calls, then the app's `fetch`, else 404. Its runtime ships as `@expressive/dev/fetch`, which the generated entry calls. Static files are the host's, forwarded by the app's `fetch`. The config's other members join the default export and `index.ts`'s named exports are re-exported; a named `bindings` export supplies `env` in dev and is left out of the build. The target serves remote functions only - a remote that default-exports a seat or exports a Model class fails the dev server and the build.

### Patch Changes

- Updated dependencies [[`54a571e`](https://github.com/gabeklein/expressive/commit/54a571e8a6902e0baedd38fac03239024fb92b46)]:
  - @expressive/rpc@0.5.0

## 0.3.1

### Patch Changes

- Updated dependencies [[`340759c`](https://github.com/gabeklein/expressive/commit/340759c8fa3a4b2b6b759e9082f8a731ee338ac2), [`b8fdacf`](https://github.com/gabeklein/expressive/commit/b8fdacf549835549513a899c49aee6122a494256)]:
  - @expressive/mvc@0.97.0
  - @expressive/router@0.10.7
  - @expressive/cli@0.2.3
  - @expressive/dom@0.13.2
  - @expressive/inspect@0.6.7
  - @expressive/rpc@0.4.4

## 0.3.0

### Minor Changes

- [#740](https://github.com/gabeklein/expressive/pull/740) [`238c830`](https://github.com/gabeklein/expressive/commit/238c830d33317aff19b0ea1a4a9d5af7b5632c66) `expressive dev build` now prerenders: each static page is rendered with `renderToString` into `dist/client/<path>/index.html`, and the client hydrates it. `--no-html` (or `runBuild(root, { html: false })`) opts out, and a failed prerender step warns and keeps the client-only build. Folders with a remote are left to the client. A `[param]` or `[...]` route module lists its pages with a `paths()` export. The empty shell is kept as `200.html`, which the built service falls back to. `hydrate` is exported beside `render`.

### Patch Changes

- [#740](https://github.com/gabeklein/expressive/pull/740) [`238c830`](https://github.com/gabeklein/expressive/commit/238c830d33317aff19b0ea1a4a9d5af7b5632c66) `expressive dev build` builds from the project's own `index.html` instead of the default shell.
- Updated dependencies [[`bd0183f`](https://github.com/gabeklein/expressive/commit/bd0183fe98b5b0085bbdacb74976bc745d218096), [`cf2e10b`](https://github.com/gabeklein/expressive/commit/cf2e10bb021364721007bf1102c76a53e8c67f25), [`0360067`](https://github.com/gabeklein/expressive/commit/0360067d50ff09d1cd72efdd5b3ee456151bfdd3), [`6711fd8`](https://github.com/gabeklein/expressive/commit/6711fd88de99b43fbb273fa0c78ebf6c6da7b414)]:
  - @expressive/dom@0.13.1
  - @expressive/mvc@0.96.0
  - @expressive/cli@0.2.2
  - @expressive/inspect@0.6.6
  - @expressive/router@0.10.6
  - @expressive/rpc@0.4.3

## 0.2.1

### Patch Changes

- Updated dependencies [[`e9dd129`](https://github.com/gabeklein/expressive/commit/e9dd12988a6d49cb72310905453519a21e05fb6b), [`977ffe0`](https://github.com/gabeklein/expressive/commit/977ffe03bbeabe44aeb744c1f2c8b4a4d7b2447d), [`14bab99`](https://github.com/gabeklein/expressive/commit/14bab993d532b7b4aea28565311d13b1d14f1575), [`b968a6d`](https://github.com/gabeklein/expressive/commit/b968a6d4eac9a3f2b4de09f77ca13941b9ac8294), [`829ff1c`](https://github.com/gabeklein/expressive/commit/829ff1ca06cab12636cd64c25f11805e67f09b4e)]:
  - @expressive/dom@0.13.0
  - @expressive/mvc@0.95.0
  - @expressive/cli@0.2.1
  - @expressive/inspect@0.6.5
  - @expressive/router@0.10.5
  - @expressive/rpc@0.4.2

## 0.2.0

### Minor Changes

- [#716](https://github.com/gabeklein/expressive/pull/716) [`356fbd2`](https://github.com/gabeklein/expressive/commit/356fbd24c6199d0edfe9696acbcf6b91ed0e3bda) **`expressive build` is now `expressive dev build`**, and bare `expressive` lists commands instead of starting the dev server - run `expressive dev`. The commands are built on `@expressive/cli`: `--help` and `help <command>` work at every level, and an unknown option is a usage error instead of being ignored.

  The `expressive` bin is shared: it also runs `expressive sql` when `@expressive/sql` is installed, and lists it as not installed otherwise.

  `expressive dev --no-inspect` runs without the `/__inspect` relay; `runDev` takes `{ inspect: false }` for the same.

### Patch Changes

- Updated dependencies [[`6cabc0b`](https://github.com/gabeklein/expressive/commit/6cabc0bccf7aab2f8b71da382b0fbc2a435fa30c), [`e71f3c9`](https://github.com/gabeklein/expressive/commit/e71f3c9b5d75c63f5efa44a15f3349ec9477afd7), [`a64f20c`](https://github.com/gabeklein/expressive/commit/a64f20c4a3a4b0b1e0c63ddd59fd2d7ba016b503), [`a64f20c`](https://github.com/gabeklein/expressive/commit/a64f20c4a3a4b0b1e0c63ddd59fd2d7ba016b503), [`0ba15e1`](https://github.com/gabeklein/expressive/commit/0ba15e14cddaa91acb635648e6f14d5f3ab2ba0e)]:
  - @expressive/cli@0.2.0
  - @expressive/dom@0.12.2
  - @expressive/rpc@0.4.1

## 0.1.5

### Patch Changes

- Updated dependencies [[`a6d2e6e`](https://github.com/gabeklein/expressive/commit/a6d2e6e8aed323e6e7dc74104a6bec8951d85656), [`a6d2e6e`](https://github.com/gabeklein/expressive/commit/a6d2e6e8aed323e6e7dc74104a6bec8951d85656)]:
  - @expressive/rpc@0.4.0

## 0.1.4

### Patch Changes

- [#661](https://github.com/gabeklein/expressive/pull/661) [`35f2d80`](https://github.com/gabeklein/expressive/commit/35f2d8084dc95ca542bc3c1eedef7a4caddb74d7) A folder's gate runs per request by default: its instance ends after the last call holding it, so a logout or revoked session takes effect on the next call. `static ttl` still caches one per key, and `set(null)` on it ends it early. dev keeps its seats for 300 seconds by default, as before.
- Updated dependencies [[`b7be047`](https://github.com/gabeklein/expressive/commit/b7be047c229a1bcaeb7906b660261e2b64edc584), [`f722198`](https://github.com/gabeklein/expressive/commit/f722198d8ae0b9fb99ad0c82e8d48c01f604085e), [`35f2d80`](https://github.com/gabeklein/expressive/commit/35f2d8084dc95ca542bc3c1eedef7a4caddb74d7), [`8503354`](https://github.com/gabeklein/expressive/commit/8503354dff1f64f65ec1f1d30e40c72c8fcc888b)]:
  - @expressive/mvc@0.94.5
  - @expressive/rpc@0.3.0

## 0.1.3

### Patch Changes

- [#678](https://github.com/gabeklein/expressive/pull/678) [`f59d49b`](https://github.com/gabeklein/expressive/commit/f59d49be2daeb6328b31196153290ec333ec7033) A route module's `export default Name` naming a class is read as its scope class, not as an entry hook.

- [#679](https://github.com/gabeklein/expressive/pull/679) [`ea0f0c6`](https://github.com/gabeklein/expressive/commit/ea0f0c63ea5d1a689084a6bc170f47087b0c05f0) Agents read each package's skill straight from `node_modules/@expressive/<pkg>/skills/`, so linking skills in with `skills experimental_sync` is no longer needed. Point an agent at them with a line in `AGENTS.md`, or `npx skills add gabeklein/expressive` for a small skill that says where they are. Skills now name each other in plain text (`expressive-mvc/component.md#props`) instead of linking a side-by-side install, and `@expressive/dev` drops its `skills` field.
- Updated dependencies [[`2e3f7c7`](https://github.com/gabeklein/expressive/commit/2e3f7c7c283b75ba2e64ffd2a58df9ab68cb4d58), [`782f0fc`](https://github.com/gabeklein/expressive/commit/782f0fc52c2b401b032d3dc3482f9e00c688f95a), [`bd24d3a`](https://github.com/gabeklein/expressive/commit/bd24d3adc98733f2f474bd959f8bde44e76cf3a3), [`9923150`](https://github.com/gabeklein/expressive/commit/9923150a93702b7e6bfb326af29889670b3f5f59), [`40a1ef0`](https://github.com/gabeklein/expressive/commit/40a1ef0ba97257ce936ff318b6768f600c2910e7), [`3042161`](https://github.com/gabeklein/expressive/commit/3042161db2e9c77999826f84cb9fc60a9736a3b2), [`ea0f0c6`](https://github.com/gabeklein/expressive/commit/ea0f0c63ea5d1a689084a6bc170f47087b0c05f0)]:
  - @expressive/dom@0.12.0
  - @expressive/router@0.10.4
  - @expressive/rpc@0.2.0
  - @expressive/mvc@0.94.3
  - @expressive/inspect@0.6.4

## 0.1.2

### Patch Changes

- [#673](https://github.com/gabeklein/expressive/pull/673) [`925f17e`](https://github.com/gabeklein/expressive/commit/925f17ef9c220739333a25dee528911a7a06e0ce) JSDoc on `Route`, `Router`, `NotFound`, `config`, `serve` and the `/vite` entry; the skill names what the root entry re-exports and links the router, dom and inspect skills.

- [#668](https://github.com/gabeklein/expressive/pull/668) [`f9eabf1`](https://github.com/gabeklein/expressive/commit/f9eabf14a39c91e069072dacbaff02657289685f) Declare the skills of dom, inspect, router and rpc in a `skills` field, so `skills sync` installs them for a project that only lists `@expressive/dev`.

- [#651](https://github.com/gabeklein/expressive/pull/651) [`173a60c`](https://github.com/gabeklein/expressive/commit/173a60ce8245f509da4a1735c4788472dea5462e) Ship each package's agent skill in the package, at `skills/expressive-<pkg>/SKILL.md`, so the docs an agent reads match the installed version. `npx skills experimental_sync` links them into `.claude/skills/` and `.agents/skills/`; `expressive-mvc` holds the core, and each package's skill links its siblings as installed side by side. On expressive.dev the skills move to `/llm/expressive-<pkg>/`, with the old `/llm/` paths redirecting.

- [#672](https://github.com/gabeklein/expressive/pull/672) [`f0e6e70`](https://github.com/gabeklein/expressive/commit/f0e6e7033237aef547d4088e69df1ced13e6880b) Skill corrections: inspect's `caught` kinds and `site`, rpc's `Redirect` status, router's guard rejection and `Redirect` timing, dom's status, dev's hand-written Vite config needing `inspect()`, and steps linking the mvc skill.

- [#668](https://github.com/gabeklein/expressive/pull/668) [`f9eabf1`](https://github.com/gabeklein/expressive/commit/f9eabf14a39c91e069072dacbaff02657289685f) Fix the skill's frontmatter, which was invalid YAML, so skill installers skipped it.
- Updated dependencies [[`5bda16e`](https://github.com/gabeklein/expressive/commit/5bda16e00c97200b7eca0d5073970fc0d8631f01), [`1ec8ba8`](https://github.com/gabeklein/expressive/commit/1ec8ba8fe5e2d765718937e45a4e3c890343092a), [`bc936ea`](https://github.com/gabeklein/expressive/commit/bc936eaa8126b9ec6918fb670ac36e6a626b2d1c), [`5fec34c`](https://github.com/gabeklein/expressive/commit/5fec34c05a268718f4dec2bdafd13de22264821c), [`11e3c48`](https://github.com/gabeklein/expressive/commit/11e3c48fbb1f27e80128a5209c5ad2ff099ddd64), [`173a60c`](https://github.com/gabeklein/expressive/commit/173a60ce8245f509da4a1735c4788472dea5462e), [`a8659ff`](https://github.com/gabeklein/expressive/commit/a8659ffa58dcdf836d01e104b8a2c1ef17b574f0), [`f0e6e70`](https://github.com/gabeklein/expressive/commit/f0e6e7033237aef547d4088e69df1ced13e6880b), [`f9eabf1`](https://github.com/gabeklein/expressive/commit/f9eabf14a39c91e069072dacbaff02657289685f)]:
  - @expressive/dom@0.11.0
  - @expressive/mvc@0.94.2
  - @expressive/router@0.10.3
  - @expressive/inspect@0.6.3
  - @expressive/rpc@0.1.1

## 0.1.1

### Patch Changes

- [#654](https://github.com/gabeklein/expressive-mvc/pull/654) [`bd67894`](https://github.com/gabeklein/expressive-mvc/commit/bd678942e7cb6a1688ff9ada6531624aa8dfd06d) Installs from npm. 0.1.0 was published with `workspace:^` ranges for `@expressive/dom`, `@expressive/rpc`, `@expressive/router` and `@expressive/inspect`, which npm cannot resolve outside this repo.

## 0.1.0

### Minor Changes

- [#644](https://github.com/gabeklein/expressive-mvc/pull/644) [`bdc4c77`](https://github.com/gabeklein/expressive-mvc/commit/bdc4c77db1ed0b52c26b0cba1ce03c306416d3d4) First release. `expressive dev` and `expressive build`: file-based routes from `app/` on `@expressive/dom` and `@expressive/router`, `remote.ts` sidecars served through `@expressive/rpc`, server Models seated per route folder, and a Node service in `dist/server`. Twins - server Models mirrored on the client - are experimental.

### Patch Changes

- Updated dependencies [[`ac9785c`](https://github.com/gabeklein/expressive-mvc/commit/ac9785cb36540a46c41c9a90ecf0b5adcb715edb), [`bdc4c77`](https://github.com/gabeklein/expressive-mvc/commit/bdc4c77db1ed0b52c26b0cba1ce03c306416d3d4)]:
  - @expressive/dom@0.10.1
  - @expressive/rpc@0.1.0

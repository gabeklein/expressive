# @expressive/steps

## 0.1.4

### Patch Changes

- [#753](https://github.com/gabeklein/expressive/pull/753) [`41f396c`](https://github.com/gabeklein/expressive/commit/41f396cc58ff6dc0ea3f444d3a2455c8c588cbc5) `then.commit()` releases the undo state of the steps it descends from, so a long run that commits periodically no longer holds every replaced field value until it ends. Those steps now stay applied even once a caught failure has unwound past the commit.

- [#752](https://github.com/gabeklein/expressive/pull/752) [`5ee327e`](https://github.com/gabeklein/expressive/commit/5ee327ed1d1e3839f9f62c3bc20060025b70a47b) A long run holds a fraction of the memory it did and runs faster: a settled step is released while the run continues, keeping only what an unwind needs - a step registering a function handler is kept until the run ends, for the handler. A handler still running when the run ends has its signal aborted. Calling `.catch()` on a step's token after the step which called it settled now throws.
- Updated dependencies [[`b968a6d`](https://github.com/gabeklein/expressive/commit/b968a6d4eac9a3f2b4de09f77ca13941b9ac8294), [`829ff1c`](https://github.com/gabeklein/expressive/commit/829ff1ca06cab12636cd64c25f11805e67f09b4e)]:
  - @expressive/mvc@0.95.0

## 0.1.3

### Patch Changes

- [#718](https://github.com/gabeklein/expressive/pull/718) [`a8c7b7b`](https://github.com/gabeklein/expressive/commit/a8c7b7b82c168b668093ede9e0e19dc5b0cfacb2) A run's cost grows linearly with its steps - wide groups and long chains (a step scheduling the next) no longer slow quadratically as they grow.

## 0.1.2

### Patch Changes

- [#679](https://github.com/gabeklein/expressive/pull/679) [`ea0f0c6`](https://github.com/gabeklein/expressive/commit/ea0f0c63ea5d1a689084a6bc170f47087b0c05f0) Agents read each package's skill straight from `node_modules/@expressive/<pkg>/skills/`, so linking skills in with `skills experimental_sync` is no longer needed. Point an agent at them with a line in `AGENTS.md`, or `npx skills add gabeklein/expressive` for a small skill that says where they are. Skills now name each other in plain text (`expressive-mvc/component.md#props`) instead of linking a side-by-side install, and `@expressive/dev` drops its `skills` field.
- Updated dependencies [[`ea0f0c6`](https://github.com/gabeklein/expressive/commit/ea0f0c63ea5d1a689084a6bc170f47087b0c05f0)]:
  - @expressive/mvc@0.94.3

## 0.1.1

### Patch Changes

- [#651](https://github.com/gabeklein/expressive/pull/651) [`173a60c`](https://github.com/gabeklein/expressive/commit/173a60ce8245f509da4a1735c4788472dea5462e) Ship each package's agent skill in the package, at `skills/expressive-<pkg>/SKILL.md`, so the docs an agent reads match the installed version. `npx skills experimental_sync` links them into `.claude/skills/` and `.agents/skills/`; `expressive-mvc` holds the core, and each package's skill links its siblings as installed side by side. On expressive.dev the skills move to `/llm/expressive-<pkg>/`, with the old `/llm/` paths redirecting.

- [#672](https://github.com/gabeklein/expressive/pull/672) [`f0e6e70`](https://github.com/gabeklein/expressive/commit/f0e6e7033237aef547d4088e69df1ced13e6880b) Skill corrections: inspect's `caught` kinds and `site`, rpc's `Redirect` status, router's guard rejection and `Redirect` timing, dom's status, dev's hand-written Vite config needing `inspect()`, and steps linking the mvc skill.

- [#652](https://github.com/gabeklein/expressive/pull/652) [`58effca`](https://github.com/gabeklein/expressive/commit/58effcac3f0f7cf54ee09aac549e41c2c0ff1e86) Hover docs: `Steps` shows its own doc again (it had attached to `Steps.Aborted`), and the controller, outcome handlers and hooks gain a summary line, contract and typechecked examples. The skill now points at them for per-member detail.
- Updated dependencies [[`5fec34c`](https://github.com/gabeklein/expressive/commit/5fec34c05a268718f4dec2bdafd13de22264821c), [`11e3c48`](https://github.com/gabeklein/expressive/commit/11e3c48fbb1f27e80128a5209c5ad2ff099ddd64), [`173a60c`](https://github.com/gabeklein/expressive/commit/173a60ce8245f509da4a1735c4788472dea5462e)]:
  - @expressive/mvc@0.94.2

## 0.1.0

### Minor Changes

- [#640](https://github.com/gabeklein/expressive-mvc/pull/640) [`e845c2e`](https://github.com/gabeklein/expressive-mvc/commit/e845c2e2428f5c6fa63c36fe6604b848e0249850) First release. `class X extends Steps` makes a Model runnable: every method is a step, a step schedules the next by calling it, and fields carry data between them. `run(...args)` is the entry - it schedules, `await this` waits for the run, and its return is the typed result of `x.run()` and `await x`. Steps compose into sequences, parallel groups, mapped groups, durations (`this.then({ min: 1 })`) and waits answered from outside or by a racing step - losing racers are unwound; each step is atomic and registers handlers for its subtree's outcomes - `this.then.on({ reset, catch, abort, close })` - `abort` when a subtree ended without completing (given the error of a failure, nothing for a cancellation), `close` a finally - runs reject with `Steps.Aborted` or `Steps.Stopped` - so a failure unwinds what committed, a step can recover what it scheduled, and a step owning a resource settles it on any ending. `.catch(handler)` recovers a branch, and a handler in `then.on` may be a step method too - a step method is recorded, given the error or reason, a function stays process-local, and `this.then.retry()` replays the failed step or group with its args; `this.then.only(max, key?)` is a gate for concurrency, `this.then.commit()` marks a point of no return, `this.then.stop()` halts and `this.then.abort()` halts and unwinds. Runs repeat and queue; status, queue and waits are reactive on `this.then`. In-process only - no durable persistence yet.

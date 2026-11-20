---
"@expressive/cli": minor
---

`main(import.meta, Type, { as })` makes a package a member of a command shared across packages: run as the entry, it roots `as` with its own command plus every installed package of its scope whose `bin` has an `as` entry - `filter` matches other names, `priority` orders the listing. Each member parses with its own copy of `@expressive/cli`. `main` now returns `Type` instead of a promise, for the bin to `export default`. A command class's own `static help` describes it in listings and atop its help; `help` is no longer required on `lazy` and `peer` commands.

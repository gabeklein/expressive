---
"@expressive/cli": minor
---

`trunk(name)` replaces `dispatch` in `@expressive/cli/bin`: a command family's shared bin, whose subcommands come from the project's declared dependencies (`package.json` `[name].bin`), with `help` descriptions, `suggest`ed commands to install, and project `commands` pins. A `Run` receives the invoked name for help text. A group run alone, or `help` in place of a command, prints help and returns 0 - it returned 2.

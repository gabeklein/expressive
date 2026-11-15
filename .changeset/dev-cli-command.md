---
"@expressive/dev": minor
---

**`expressive build` is now `expressive dev build`**, and bare `expressive` lists commands instead of starting the dev server - run `expressive dev`. The commands are built on `@expressive/cli`: `--help` and `help <command>` work at every level, and an unknown option is a usage error instead of being ignored.

The `expressive` bin is shared: it also runs `expressive sql` when `@expressive/sql` is installed, and lists it as not installed otherwise.

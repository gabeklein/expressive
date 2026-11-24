---
'@expressive/cli': minor
---

Add `--json` to every command: one line with `code`, captured `stdout` and `stderr`, and `error` on failure. `--help --json` describes the routed command and its subcommands, with a JSON Schema per input.

Breaking: `--json` is reserved, so a field named `json` throws.

Breaking: `run()` returning anything but nothing, a boolean or an exit code is an error instead of being printed.

Help and usage errors no longer start Models held in plain fields at any depth - each class on the path is read from a bare instance first. `parse` and `valid` see only the value.

---
"@expressive/rpc": minor
---

`Current.get().env` reads the `env` the built server's `fetch` got (the plugin's `env` in dev, `{}` without). Type it by extending the exported `Env` interface.

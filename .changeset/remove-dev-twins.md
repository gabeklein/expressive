---
"@expressive/dev": minor
---

Remove twins. A remote entry's default Model no longer reaches the client: there is no twin of it, no `route.remote`, no pooled Model classes, and no stream at `/.expressive/stream`. Methods on the default Model are no longer callable from the client, and a remote that exports a Model class now fails the build. Every remote entry's default is now checked whether or not the client imports it, so a fetch-target build fails on a gate it would otherwise have silently dropped. The default Model stays as rpc's class gate: `static key()` gives an instance per key, and `static ttl` caches that instance (0 by default, where dev used to default to 300). Don't rely on state surviving between calls.

---
"@expressive/dev": minor
---

Remove twins. A remote entry's default no longer reaches the client: there is no twin of it, no `route.remote`, no pooled Model classes, and no stream at `/.expressive/stream`. Methods on a default Model are no longer callable from the client, and a remote that exports a Model class now fails the build. A remote entry's default is now a function gate, run before each call through its folder: it refuses by throwing or by activating a Model whose `new()` fails, and the Models it activates are found by `get()` in the call. A class default - including a Model with `static key()`/`ttl` - fails the build.

---
"@expressive/rpc": minor
"@expressive/dev": minor
---

One request scope per request: `Current` gains `params`, `json(check?)`, `text()`, `ctx`, `next` and `send` (and static `Current.send`). A function gate may wrap what is below it with `next()`, and answers instead of passing by `send`, a returned `Response` or a returned fetch handler. Headers and cookies join the reply of the layer that set them. `json()` and `text()` read a body cached once and capped at 1 MB. `@expressive/rpc/protocol` gains `layer` and `bind`'s `ctx`. The client rejects a reply that isn't rpc's codec with an `HttpError` carrying its status. Outside a request, `Current` now says it "resolves only within a request".

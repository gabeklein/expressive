---
"@expressive/rpc": patch
---

`send` waits for the response to drain before writing more, and cancels the body when the connection closes - a slow or gone client no longer buffers a whole streamed reply. A body that fails mid-stream aborts the response instead of ending it.

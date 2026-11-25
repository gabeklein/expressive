---
"@expressive/dev": minor
"@expressive/rpc": minor
---

Gate check. Before entering a gated folder's pages - one whose remote entry exports a gate - the browser runs its gates once, sending one request to the deepest gated folder on the path. A pass covers that folder until a param changes; moving inside it, or leaving gated folders, sends nothing. A refusal reaches `Catch`, whose `retry` checks again; an error with a 3xx `status` and `location`, or a 3xx `Response` from the gate, redirects (another origin through `location.assign`, a loop into the same folder to `Catch`). A network failure or a reply that isn't rpc's passes, and a newer navigation drops an in-flight verdict. Gated folders are not prerendered. In dev, editing a gate clears the passes the browser remembered. On the wire, rpc's `call(path, "")` sends an unnamed `x-expressive-get`, which runs the folder's gates and answers `{}`.

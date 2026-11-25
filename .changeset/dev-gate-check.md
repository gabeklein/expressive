---
"@expressive/dev": minor
"@expressive/rpc": minor
---

Gate check. Before entering a gated folder's pages - one whose remote entry exports a gate - the browser runs its gates once, sending one request to the deepest gated folder on the path. A pass covers that folder until a param changes; moving inside it, or leaving gated folders, sends nothing. A refusal reaches `Catch`, whose `retry` checks again; an error with a 3xx `status` and `location`, or a 3xx `Response` from the gate, redirects (another origin through `location.assign`, a loop into the same folder to `Catch`). A path no page route matches loads through `location.assign`, so a redirect to a server route works; a second redirect in a row, or a scheme other than `http:` or `https:`, reaches `Catch`. A network failure or a reply that isn't rpc's lets the page in without remembering a pass, and a newer navigation drops an in-flight verdict. Gated folders are not prerendered. In dev, editing a gate clears the passes the browser remembered.

Route tree fixes: a folder's `NotFound` is now a child of its route, so it shows for missing paths under a folder that has a param page beside it; a folder whose `[...]` page catches every path below warns that its `NotFound` never shows; and a static page now wins over a param folder beside it (`/room/new` no longer also renders `[id]/`). A sidecar call from a `[param]` folder's entry hook, during an in-app navigation, fills its params from the path being entered.

In rpc, a folder gate now reads its own folder's params from `Current.get().params`. A call that throws an error with a 3xx status - `Redirect` included - now replies HTTP 400 instead of 500, its `status` and `location` intact in the body. `call(path, "")` sends `x-expressive-get: gates`, which runs the folder's gates and answers `{}`; it resolves `true` on a pass and `false` when the reply can't tell (a network failure, a non-rpc reply, a 404).

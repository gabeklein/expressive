---
"@expressive/dev": minor
"@expressive/rpc": minor
---

Route tree fixes: a folder's `NotFound` is now a child of its route, so it shows for missing paths under a folder that has a param page beside it; a folder whose `[...]` page catches every path below warns that its `NotFound` never shows; and a static page now wins over a param folder beside it (`/room/new` no longer also renders `[id]/`).

In rpc, a folder gate now reads its own folder's params from `Current.get().params`. A call that throws an error with a 3xx status - `Redirect` included - now replies HTTP 400 instead of 500, its `status` and `location` intact in the body.

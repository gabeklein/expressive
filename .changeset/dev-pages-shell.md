---
"@expressive/dev": minor
---

One page rule on every host. Below calls, a request gets its file or `<path>/index.html`, else the shell (`200.html`, else `index.html`) - only for GET or HEAD outside `build.assetsDir`, so a stale chunk stays a 404. A path some page route matches gets the shell with 200; a navigation no route matches gets it with 404, so the router's `NotFound` still renders; anything else is a bare 404. On the fetch target, pages come from `env.ASSETS` by default, so a Worker no longer falls back to its assets by hand in `handle`. Node narrows to the same rule: it served files and the shell for any method and path.

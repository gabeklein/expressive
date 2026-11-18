---
"@expressive/dev": minor
---

Server edits in `expressive dev` no longer leave a second copy of the server running. An edit that no module accepts, or one that makes `@expressive/mvc/hot` replace a Model class instead of patching it, restarts the server code in place: seats and pooled instances end, `import.meta.hot.dispose` callbacks run, modules run again from their new source, and every tab rejoins under a new epoch. `expressive dev` adds `@expressive/dom/vite` for hot patching unless the app's Vite config already does. `GET /.expressive/stats` reports counts of connections, held twins, watchers, layers, seats and pooled instances.

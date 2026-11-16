---
"@expressive/dev": minor
---

Server edits in `expressive dev` no longer leave a second copy of the server running. An edit that no module accepts restarts the server code in place: seats and pooled instances end, `import.meta.hot.dispose` callbacks run, and every tab rejoins under a new epoch. A Model class that `@expressive/mvc/hot` replaces instead of patching retires only that class's seats and pooled instances. `expressive dev` adds `@expressive/dom/vite` for hot patching unless the app's Vite config already does. `GET /.expressive/stats` reports counts of connections, held twins, watchers, layers, seats and pooled instances.

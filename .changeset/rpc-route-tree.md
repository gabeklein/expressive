---
"@expressive/rpc": minor
---

The server is a tree of calls you could write by hand. `route(gate, children)` and `handler(tree, { base, errors })` from `@expressive/rpc/http` serve one without the plugin, and the plugin's own server is that same tree.

Breaking:

- A call's address is its place in the tree: `api/admin/users.ts#ban` posts to `/admin/users` as `ban`, where it was `/admin` as `users:ban`.
- Builds keep readable names. `rpc({ opaque: true })` seals them.
- An exported Error class crosses by its export name (`Duplicate`), unique across the app - two classes under one name fail the build.
- `with` and `then` are reserved: no call, module or folder may take them.

Client:

- `client<T>().api` is a typed tree of calls, and the shared client's `api` backs every stub.
- Any node or call takes `.with({ signal, timeout })` - an abort rejects with the signal's reason, a timeout with a `TimeoutError`.
- `errors: { Duplicate }` in `client()` or `configure()` rebuilds a thrown error as that class.

In dev, a thrown Error subclass the server does not know warns once, naming its class - a build replies "Internal error." for it.

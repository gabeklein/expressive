---
"@expressive/rpc": minor
---

Remove host plumbing with no remaining user. Nothing replaces these - `handler`, `dispatch` and `failure` cover what they did.

- `@expressive/rpc/protocol`: `attempt`, `classId`, `construct`, `fault`, `inFolder`, `invoke`, `locate`, `onBuild`, `registry`, `resolve`, `seated`, `seatsAlong`, `walkOf`, and the types `Call`, `Exports`, `Fault`, `Folder`, `Handle`, `Incoming`, `Invocation`, `Located`, `Match`, `Options`, `Outcome`, `Seat`, `Tier`. `dispatch` drops its `tier` argument - `skip` moves up to fifth.
- `@expressive/rpc/http`: `reply`. `isCall`, `send` and `toRequest` move to `@expressive/rpc/protocol` - `/http` keeps `handler`, `route`, `scoped` and `toNode`. `handler` takes only a tree from `route()` - the endpoint-list form and the `dev` and `seats` options go.
- `@expressive/rpc/vite`: `SCRIPT`, `locate`, `pathOf`, and the types `Extension`, `Locate`, `Located`, `Parent`, `Scan`, `Stub`. `scanModule` drops its `extension` argument - `only` moves up to fifth. `Manifest` drops `byPattern`, `table` and `exports`, `stub`'s `imports` and `lines` options, and makes `parentId` protected.
- `client()` no longer returns `pathOf` or `send`.

A request with `x-expressive-get` and no `x-expressive-call` is no longer a call, and a 304 reply to a call rejects with an `HttpError` like any other non-codec reply.

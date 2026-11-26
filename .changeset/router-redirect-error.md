---
"@expressive/router": minor
---

`Redirect` is now an error, and the `<Redirect>` component is gone. Throw it while rendering or from a Component's `new()` - sync or async - and the nearest `Route` catches it and navigates to its `to`. The decision becomes a value the router acts on, so a tree rendered under a held navigation no longer navigates as a side effect of mounting.

History is replaced on a cold load and pushed during in-app navigation, so Back still reaches the page the user came from. A `redirect` prop verdict follows the same rule (it always replaced before) and navigates once per verdict.

Every `Route` is now a `catch` boundary: it handles `Redirect` and passes any other error to the next boundary up. A `Route` subclass overriding `catch` returns `super.catch(error)` for what it doesn't handle.

Migrating:

- `<Redirect to="/x" />` → `throw new Redirect("/x")`
- `<Redirect when={x} to="/x" />` → `if (x) throw new Redirect("/x")`
- `replace` → dropped; replacing follows the cold-load rule above
- in an event handler or effect → `Route.get().goto("/x")`

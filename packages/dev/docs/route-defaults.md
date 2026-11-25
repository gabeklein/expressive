# Route exports, redirects and not-found

Design note for `@expressive/dev`'s route modules and `@expressive/router`'s redirects. Lands on the `feat/dev-serve` trunk beside the server entry, so apps port once.

## The recipe

What a new user reads, once this lands.

A route module can export up to three things, nested in this order - each optional, a missing one passes its content through:

```
default  →  Layout  →  Page
```

| Export | Use it for |
| --- | --- |
| `default` | State for this route and everything below it - a Model, or a Component that also wraps. In a leaf, the page itself. |
| `Layout` | Chrome around the page: headers, tabs, a frame. |
| `Page` | The page, when `default` holds state - a folder's index page, or a leaf whose state and view are separate. |
| `Catch` | What shows when something below can't be shown, "not found" included. |

### A page that needs a signed-in user

```tsx
// app/me/index.tsx
import { Redirect } from "@expressive/dev";
import { Component, get, set } from "@expressive/mvc";

import { Session } from "../session";
import * as auth from "../signin/remote";

export default class Me extends Component {
  session = get(Session);
  account = set(auth.profile);

  protected new() {
    const { me } = this.session;

    if (!me) throw new Redirect("/signin");
  }
}

export function Page() {
  const { account } = Me.get();

  return <h1>Hi, {account.name}</h1>;
}
```

`Me` checks the session before anything renders; signed out, it throws `Redirect` and the route sends the visitor to `/signin`. `account` loads on its first read, so a signed-out visitor never requests it. Everything under `/me` reaches the state through `Me.get()`.

### A page whose record might not exist

```tsx
// app/card/[id].tsx
import { NotFound, Route } from "@expressive/dev";

import { Cards } from "../cards";

export default function Card() {
  const { match } = Route.get();
  const cards = Cards.get();
  const card = cards.find(match.id);

  if (!card) throw new NotFound();

  return <CardView card={card} />;
}
```

A leaf's `default` is its page. `NotFound` shows the folder's not-found screen; the URL stays. The same screen shows for any address under the folder that matches no page.

### What shows instead

```tsx
// app/card/index.tsx
import { NotFound } from "@expressive/dev";

export function Catch({ error, retry }) {
  if (error instanceof NotFound) return <p>That card doesn't exist.</p>;

  return (
    <div>
      <p>Something went wrong.</p>
      <button onClick={retry}>Try again</button>
    </div>
  );
}
```

`Catch` covers the folder and everything below. Without one, dev shows a plain not-found page for `NotFound` and a generic error otherwise.

### On the server, the same errors

```ts
// app/admin/remote.ts - the folder's gate
import { Redirect } from "@expressive/dev";

import { Session } from "../session";

export default () => {
  const { staff } = Session.get();

  if (!staff) throw new Redirect("/signin");
};
```

A gate runs on the server for every call under the folder, and in the browser before any of its pages open.

### Good to know

- Throw while deciding what to show: in `new()`, in an async `new()` after an `await`, or while rendering. In a click handler, navigate with `Route.get().goto("/somewhere")` - a throw there is just an error.
- Moving between pages never flashes: the current screen holds while the next page decides, and a redirect goes straight to its target.
- A redirect back into the same folder shows `Catch` rather than looping.

## Why

Today a route module's `default` is read by kind - a function is an entry hook, a class wraps the route - and redirect and 404 have several spellings: a hook's returned string or `null`, the router's `<Redirect to>`, rpc's thrown `Redirect` in gates, and a `NotFound` route export. Two different classes are named `Redirect`. In a real port:

- A page's state couldn't guard itself without being split away from the page.
- `<Redirect>` navigates as a side effect of mounting. Under a held navigation, a tree not yet committed can navigate - one port's redirect cancelled the navigation it sat in.
- A component can't become a server status without rendering with side effects; a thrown value can.

## Settled

- **Nesting:** `default` → `Layout` → `Page`, each optional, a missing one a passthrough. A Component `default` places `Layout`/`Page` as `props.children`; one that doesn't place them is the page.
- **A leaf's `default` is its page.** `Page` stays for index modules and for leaves whose state and view are separate.
- **Redirect and not-found are thrown errors**, caught by the route: `Redirect` navigates, `NotFound` renders the folder's `Catch`. One spelling in pages, `new()`, gates and calls.
- **The 404 folds into `Catch`.** The `NotFound` route export goes; an unmatched URL throws `NotFound` into the same `Catch`.
- **The router's `<Redirect>` component is deleted**, in the router itself, not only in dev.
- **No entry hook.** A function `default` is a wrapper (or, in a leaf, the page).
- **A dev app imports nothing from `@expressive/rpc` or `@expressive/router`.**

## The errors

`Redirect` and `NotFound` are `Error` subclasses. dev re-exports rpc's - which already extend `HttpError`, so a gate or call throwing one answers 302 or 404 today.

dev's `Route` is the catch boundary above every page. Its handler:

| Thrown | Outcome |
| --- | --- |
| `Redirect` | `goto(location)`, replacing the entry |
| `NotFound` | the folder's `Catch`, with the error |
| anything else | the folder's `Catch`, with `retry`, as now |

Where it is caught: a page's render, a component's `new()` (async included, after an `await`), and a `default`'s `new()`. A throw in an event handler is outside any render; it surfaces as an error, and navigation there stays `Route.get().goto()`.

On an in-app navigation the incoming tree renders behind the held screen, so a caught redirect commits nothing of the page. A redirect into the folder that threw it goes to `Catch`, as gate checks do.

### Self-gating

A `default` or page class gates itself in `new()`. mvc's async `set()` factories run lazily, on first read; `new()` runs before render, so a redirect thrown there prevents every load behind it - the state never guards itself.

### The 404 folds into `Catch`

- A folder's unmatched URL: the route's catch-all child throws `NotFound`, reaching the folder's `Catch`.
- A page's missing record: the page throws `NotFound`, reaching the same `Catch`.
- dev's default `Catch` renders a plain not-found page for `NotFound`, so a folder without one still has a 404.

### Status

- An unmatched URL keeps its 404 from the server, which sees the path (page patterns in each entry).
- A page's thrown `NotFound` is a render state on the client - status 200. A formal 404 (or 302) from a page waits for server rendering, later in the product cycle; the thrown value is what that phase reads.
- Prerender: a page that throws `Redirect` or `NotFound` at build is skipped with a warning and served the shell, so the browser decides.

## The router

The router drops `<Redirect>` and recognizes the same errors - without depending on rpc, which it can't (client-only).

- **A shared shape, not a shared class.** The router's catch reads any error with a string `location` as a redirect and any with `status === 404` as not found. The router ships minimal `Redirect` and `NotFound` classes carrying those fields, for router-only apps. dev re-exports rpc's, which carry them already. No package imports another's class.
- **`Route`'s `redirect` prop** stays, calling `goto` directly instead of rendering `<Redirect>`.
- **Breaking.** `<Redirect>` is in the router's compatibility contract (AGENTS.md guardrails). A `minor` changeset with a migration line (`<Redirect to>` → `throw new Redirect(to)`), and the guardrail updated to name the errors instead of the component.
- One router PR: the errors, the catch handling, the component deleted.

## One import source

rpc and the router are dev's implementation, not the app's dependencies.

| Need | From |
| --- | --- |
| `Route`, `Router`, `Link`, `NavLinks` | `@expressive/dev` (already) |
| `Redirect`, `NotFound`, `HttpError` and the rest of the family | `@expressive/dev`, re-exported from rpc |
| `Current`, `Cookies` | `@expressive/dev/server` (already) |
| `Env` augmentation | `@expressive/dev` (already) |

- The trunk's README and skill import `Forbidden` and `Redirect` from `@expressive/rpc` in the api/ and gate-check recipes (README lines 137, 151, 629, 648; skill lines 74, 99). They switch to dev, and the skill's "two `Redirect`s" warning goes.
- Both packages are hoisted into `node_modules`; dev's plugin warns when an app module imports `@expressive/rpc` or `@expressive/router`, naming the dev export. `@expressive/mvc` stays the app's peer.
- `Route.get().match` becomes non-optional - a page only renders when its route matched.

## Migration (unreleased trunk, plus 0.5)

| Before | After |
| --- | --- |
| `export default (route) => "/login"` (entry hook) | `throw new Redirect("/login")` in the page or the `default`'s `new()` |
| hook returning `null` | `throw new NotFound()` |
| `<Redirect to="/x" />` | `throw new Redirect("/x")` |
| `export function NotFound` in a route module | `Catch` handling `error instanceof NotFound` |
| `Redirect` / `Forbidden` from `@expressive/rpc` | from `@expressive/dev` |
| a leaf's `export function Page` | `export default` (`Page` still works) |
| `default` class wrapping `Layout` | unchanged |

A function `default` can't be told apart from a 0.5 entry hook by shape. Generation catches the common case: a function `default` that declares a parameter (a hook's `route`) fails, naming the module and pointing here. `minor`, pre-1.0.

## Queued

- **Params as index exports.** `[param]` and `[...]` files folded into the folder's `index` as exports receiving their match, like `Catch`. That makes the index define several pages - `Page`, the param page, the rest page - which is why `Page` stays a full export.
- **`(route).ts` against `_private.ts`** for marking routes and helpers, across `app/`, `api/` and MDX.

## Open questions

1. **What mvc's `catch` sees.** Confirm the route's handler receives a descendant's rejected async `new()` and errors from effects after mount, not only render and setup.
2. **Holding on a thrown redirect.** The held navigation must treat a caught `Redirect` from the incoming tree as "navigate instead", not as an error commit. Confirm with dom's transitions and with React under the compat host.
3. **Shape-matching false positives.** Any error with `status === 404` reads as not found - a fetch library's 404 error thrown from a page would show the folder's not-found screen. Probably right; a symbol brand would be stricter.
4. **The plugin warning's strength.** Warn, or fail the build.

## New public surface

- `Redirect`, `NotFound` and the `HttpError` family re-exported from `@expressive/dev`.
- `Redirect` and `NotFound` error classes in `@expressive/router`; the `<Redirect>` component removed.
- Behaviour: route nesting `default` → `Layout` → `Page`; a leaf's `default` is its page; the entry hook and the `NotFound` route export removed; `Route.get().match` non-optional; dev's plugin warns on direct rpc and router imports.

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
- **dev's `Route` and `Router` recognize the errors**, by extending the router's. The router learns nothing about HTTP; `NotFound` is dev's alone.
- **No entry hook.** A function `default` is a wrapper (or, in a leaf, the page).
- **A dev app imports nothing from `@expressive/rpc` or `@expressive/router`.** Neither is the app's dependency; dev's docs and skill never show those imports.

## The errors

`Redirect` and `NotFound` are `Error` subclasses - rpc's, which already extend `HttpError`, so a gate or call throwing one answers 302 or 404 today. dev re-exports them.

dev's `Route` (already a subclass of the router's) overrides `catch()` and checks `instanceof` against those classes; dev depends on rpc, so no brand or shape-matching is needed, and a third-party error carrying a `status` never reads as a 404. No monkeypatching - the subclasses are dev's exports.

| Thrown | Outcome |
| --- | --- |
| `Redirect` | `goto(location)`, replacing the entry |
| `NotFound` | the folder's `Catch`, with the error |
| anything else | the folder's `Catch`, with `retry`, as now |

### Where they are caught

Everything that decides what a route shows:

- **Render.** A throw while rendering reaches the route's boundary (`Component.catch()`).
- **A synchronous throw in `new()`**, or in a required `set(fn, true)` factory - construction runs inside render, so it reaches the boundary too.
- **An async `new()`, or an async required factory, that rejects.** mvc reports these to `Model.on({ catch })` with kind `setup`, not to a boundary; a component reading the failed instance's fields gets the same error and reaches the boundary, but one nobody reads would escape uncaught. dev installs a `Model.on({ catch })` policy that takes a `setup` report carrying `Redirect` or `NotFound` and hands it to the instance's route, so a guard behaves the same whether or not render reads it.

Not caught: effects after mount and event handlers. They act rather than decide; a throw there is an error, and navigation stays `Route.get().goto()`. A sign-out while on a guarded page re-renders, so a check during render covers it.

### Holding the screen on a redirect

On an in-app navigation the incoming tree renders behind the held screen, swapping in once ready; a suspension extends the hold. For a `Redirect`, the route's `catch()` calls `goto(location, { replace: true })` and returns a promise that settles only when the route is destroyed:

- the subtree stays suspended, so the held screen stays up until the redirect's target is ready - no `Catch` flash, no half-built page;
- the redirected tree is discarded without committing, which destroys the route and settles the promise - nothing outlives it;
- `replace` keeps the guarded URL out of history, so Back doesn't bounce.

A redirect into the folder that threw it goes to `Catch`, as gate checks do.

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

The router stays HTTP-free - not browser-only, let alone dom-only, so "404" isn't its concept. It does gain a thrown redirect, because the timing problem is any SPA's, not dev's:

| Where a redirect is decided | `goto` works? |
| --- | --- |
| an event handler, an effect after mount | yes - nothing is rendering |
| `Route`'s `redirect` prop | yes - the router owns the moment |
| while rendering, or in `new()` | no - a side effect in a tree that may never show |

`<Redirect>` is the last row: it calls `goto` from its own `new()`, so under a held navigation a tree not yet committed navigates. A thrown redirect makes the decision a value the router acts on from its catch.

- **A router-native `Redirect` error** - navigation only, no status. The router's `Route` catches it with the held redirect above: `goto(location, { replace: true })` and a `catch()` promise settled when the route is destroyed.
- **The `<Redirect>` component is deleted.** Its one legitimate job, redirecting during render, moves to the throw; `goto` covers the rest. The `redirect` prop calls `goto` directly. Breaking: `minor`, a migration line (`<Redirect to>` → `throw new Redirect(to)`), and the AGENTS.md guardrail names the error instead of the component.
- **dev's `Route` accepts both** the router's `Redirect` and rpc's, extending the router's catch. dev re-exports rpc's, which works on the server too.
- **Two classes named `Redirect`, never in one app's imports:** router-only apps import the router's, dev apps import rpc's through dev. rpc can't extend the router's without depending on a client-only package.
- **Its own PR, against `main`, in either order.** dev handles rpc's `Redirect` in its own `Route` regardless; accepting the router's is additive once that ships.

## One import source

rpc and the router are dev's implementation, not the app's dependencies.

| Need | From |
| --- | --- |
| `Route`, `Router`, `Link`, `NavLinks` | `@expressive/dev` (already) |
| `Redirect`, `NotFound`, `HttpError` and the rest of the family | `@expressive/dev`, re-exported from rpc |
| `Current`, `Cookies` | `@expressive/dev/server` (already) |
| `Env` augmentation | `@expressive/dev` (already) |

- The trunk's README and skill import `Forbidden` and `Redirect` from `@expressive/rpc` in the api/ and gate-check recipes (README lines 137, 151, 629, 648; skill lines 74, 99). They switch to dev, and the skill's "two `Redirect`s" warning goes.
- Neither package is in the app's `package.json`. A direct import resolves only through hoisting, and the docs never show one, so no enforcement is planned. `@expressive/mvc` stays the app's peer.
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

1. **The held redirect on both hosts.** The never-settling `catch()` keeping the hold needs a test under dom's transitions and React's under the compat host.

## New public surface

- `Redirect`, `NotFound` and the `HttpError` family re-exported from `@expressive/dev`.
- `@expressive/router`: a `Redirect` error; the `<Redirect>` component removed.
- Behaviour: route nesting `default` → `Layout` → `Page`; a leaf's `default` is its page; the entry hook and the `NotFound` route export removed; `Route.get().match` non-optional; dev's `Route` catches `Redirect` and `NotFound`, and a `Model.on({ catch })` policy routes `setup` reports carrying them.

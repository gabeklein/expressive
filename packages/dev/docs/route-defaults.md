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

`Session` here is the app's signed-in state, provided at the root.

```tsx
// app/me/index.tsx
import { Redirect } from "@expressive/dev";
import { Component, get, set } from "@expressive/mvc";

import { Session } from "../session";
import * as account from "./remote";

export default class Me extends Component {
  session = get(Session);
  profile = set(() => account.profile());

  protected new() {
    const { me } = this.session;

    if (!me) throw new Redirect("/signin");
  }
}

export function Page() {
  const { profile } = Me.get();

  return <h1>Hi, {profile.name}</h1>;
}
```

`Me` checks the session before anything renders; signed out, it throws `Redirect` and the route sends the visitor to `/signin`. `profile` loads on its first read, so a signed-out visitor never requests it. Everything under `/me` reaches the state through `Me.get()`.

### A page whose record might not exist

```tsx
// app/card/[id].tsx
import { NotFound, Route } from "@expressive/dev";

import { Cards } from "../cards";
import { CardView } from "./CardView";

export default function Card() {
  const { match } = Route.get();
  const cards = Cards.get();
  const card = cards.find(match!.id);

  if (!card) throw new NotFound();

  return <CardView card={card} />;
}
```

A leaf's `default` is its page. `NotFound` shows the folder's not-found screen; the URL stays. The same screen shows for any address under the folder that matches no page.

### What shows instead

```tsx
// app/card/index.tsx
import { NotFound } from "@expressive/dev";

export function Catch({ error, retry }: { error: Error; retry(): void }) {
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
import { Redirect } from "@expressive/dev/server";

import { Session } from "../session";

export default () => {
  const { staff } = Session.get();

  if (!staff) throw new Redirect("/signin");
};
```

A gate runs on the server for every call under the folder, and in the browser before any of its pages open.

### Good to know

- A `default` class guards in `new()`, and may `await` first - the route builds it before showing anything, so the current screen stays up while it decides.
- A page throws while rendering - a missing record, say. The folder's fallback shows until the next screen is ready.
- In a click handler, navigate with `Route.get().goto("/somewhere")` - a throw there is just an error.
- `new()` runs once. A guard there doesn't re-run on sign-out; a page that must react to it reads the session while rendering.
- A redirect followed straight away by another shows `Catch` rather than looping.

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
- **No entry hook for apps.** A function `default` is a wrapper (or, in a leaf, the page).
- **A dev app imports nothing from `@expressive/rpc` or `@expressive/router`.** Neither is the app's dependency; dev's docs and skill never show those imports.

## The errors

`Redirect` and `NotFound` are `Error` subclasses - rpc's, which already extend `HttpError`, so a gate or call throwing one answers 302 or 404 today. dev re-exports them from its root and from `/server`.

dev's `Route` (already a subclass of the router's) overrides `catch()` and checks `instanceof` against those classes; dev depends on rpc, so no brand or shape-matching is needed, and a third-party error carrying a `status` never reads as a 404. No monkeypatching - the subclasses are dev's exports.

| Thrown | Outcome |
| --- | --- |
| `Redirect` with a `location` | `goto(location, replace)` - replacing only when the guarded URL is the committed entry (a cold load), pushing otherwise |
| `NotFound` | the folder's `Catch`, with the error |
| anything else | the folder's `Catch`, with `retry`, as now |

`replace` is only right on a cold load: during an in-app navigation `BrowserRouter.next` writes history after the hold, so the entry under the redirect is still the page the user came from, and replacing it would lose that page from Back.

### Two places a route decides

**Before render: the `default`.** The route builds its `default` class itself, before rendering anything below, during the navigation's hold - the moment the old entry hook ran (dev's `enter` step, which the gate check already uses). Control and context flow are unchanged:

- built with `Default.new(Context.get(route))`, so it is homed in the route's context and its `get()` instructions resolve from above, as when the tree constructs it;
- the route waits for it to be ready, so `new()` may `await` before deciding;
- a `Redirect` or `NotFound` thrown or rejected from `new()` reaches the route directly - nothing rendered, no boundary, nothing logged, and the held screen stays up;
- once it passes, the route provides it below: a Model through `<Component for={instance}>`, a Component placed as `{instance}` with `Layout`/`Page` as its `children`. `X.get()` finds it from everything below, as now;
- the route destroys it when the route is left.

Checked on dom and on React, with and without `StrictMode`: the context resolves, a guard throw is caught before render and its lazy loads never run, a Component `default` renders around its children, and the instance is destroyed with the route. Under preact compat a Model `default` works but a Component placed as `{instance}` renders nothing (open question 1).

A `default`'s required `set(fn, true)` factories hold its `ready`, so they decide before render too.

**During render: everything else.** A page - a `Page` export, or a leaf's function `default` - and anything below it throws while rendering. That reaches the route's boundary (`Component.catch()`), as does a synchronous throw from a component constructed during render. Checked on dom and React. Here the boundary's fallback shows until the next screen is ready (below), and a throw from `new()` after an `await` comes too late - the page has committed - so a component built during render throws before its first `await`, or decides in a required field the page reads.

Not caught: effects after mount and event handlers. They act rather than decide; a throw there is an error, and navigation stays `Route.get().goto()`.

A nearer boundary intercepts first. Order, outside in: the folder Route (`Catch`) › `default` › `Layout` › the page Route (`Loading`) › the page. A `default` Component with its own `catch` sees `Redirect` and `NotFound` before the folder's `Catch`, so an app `catch` rejects what it doesn't handle. `Catch` renders outside `default`, so `Me.get()` isn't available inside it.

mvc reports an async `new()` rejection to `Model.on({ catch })` with kind `setup`; unhandled, it escapes. dev's policy marks a `setup` report carrying `Redirect` or `NotFound` handled - the route has already acted on it - so nothing escapes or logs.

### Redirect, and what the screen shows meanwhile

The route's `catch()` calls `goto` and returns a promise that settles when the redirect's navigation leaves the route - `router.path` changes, or the router's next navigation resolves. A route stays mounted across navigation (an unmatched one renders `null`), so "destroyed" never comes.

A `default` that redirects before render leaves the held screen up until the target is ready. A page that throws during render shows the boundary's fallback - blank, or `Loading` - while the target loads. An error isn't a suspension: dom runs `recover()` at once and draws the fallback, and React commits the error boundary, so the old screen doesn't hold through a render-time redirect. Accepted for now; holding it needs a host seam (follow-up, below).

A redirect caught straight after another redirect goes to `Catch` - a loop guard by sequence, not by folder, so an index page redirecting into its own child (`/settings` → `/settings/profile`) works.

### Self-gating

A `default` class gates itself in `new()`. The route builds it before render and waits for it, so the guard may `await`, and its lazy `set()` factories - which run on first read - never run behind a redirect. The state never guards itself.

The recipe relies on #832 (mvc): factory fields become writable without a no-op callback, so the page can patch `profile` after a save. #832 keeps factories lazy - a write before the first read skips the factory - so the gate still runs first.

A factory is called with its field's key (`value.call(subject, key)`), and an rpc stub passes every argument to the server, so `set(account.profile)` would send `"profile"`. Wrap it: `set(() => account.profile())`.

### The 404 folds into `Catch`

- A folder's unmatched URL: the route's catch-all child throws `NotFound`, reaching the folder's `Catch`.
- A page's missing record: the page throws `NotFound`, reaching the same `Catch`.
- dev's default `Catch` renders a plain not-found page for `NotFound`, so a folder without one still has a 404.
- Which folders get a catch-all child: the root, and every folder exporting `Catch`.
- `Catch` makes its module eager (it must be on hand before anything below can fail), so folding `NotFound` into it pulls that index and its imports into the entry chunk. Accepted; a loadable `Catch` is a later optimisation.

### Leaving not-found

`NotFound` leaves the URL as it was, so links, `goto` and Back work as from any page.

- **A caught error clears on navigation.** A boundary leaves its fallback only when its `catch()` promise settles, and the folder route's own `match` doesn't change between siblings (`matchPattern` is exact). So the route settles its `catch()` promise when `router.path` changes, and restores its `fallback` (to `Loading`) afterwards - dom doesn't put back a fallback that `catch()` overwrote.
- **Same URL: `retry`.** `Catch` gets `retry` for every error, `NotFound` included; it re-runs the page, which renders if the record exists now or throws again. A reload does the same.
- **No automatic recovery.** A thrown `NotFound` replaces the page with `Catch`, so nothing watches for the record. Throw it when the URL names nothing - a bad id, a deleted record. When an absence is temporary and the page should notice it ending (data still syncing, a list that will fill), render an empty state instead - an ordinary conditional, not a 404.

### Status and prerender

- An unmatched URL keeps its 404 from the server, which sees the path (page patterns in each entry).
- A page's thrown `NotFound` is a render state on the client - status 200. A formal 404 (or 302) from a page waits for server rendering, later in the product cycle; the thrown value is what that phase reads.
- Prerender: on the server the route's `catch()` rejects rather than holds - `renderToString` awaits a held promise until its settle timeout. A thrown `Redirect` takes prerender's existing "redirected at build" branch; a `NotFound` skips the page. Either way the path gets the shell and the browser decides.
- dev's `setup` policy defers to the prerender entry's own `Model.on({ catch })` while prerendering, so a page's failure still reaches it.

## The router

The router stays HTTP-free - not browser-only, let alone dom-only, so "404" isn't its concept. It does gain a thrown redirect, because the timing problem is any SPA's, not dev's:

| Where a redirect is decided | `goto` works? |
| --- | --- |
| an event handler, an effect after mount | yes - nothing is rendering |
| while rendering, or in `new()` | no - a side effect in a tree that may never show |

`<Redirect>` is the second row: it calls `goto` from its own `new()`, so under a held navigation a tree not yet committed navigates. A thrown redirect makes the decision a value the router acts on from its catch.

- **A router-native `Redirect` error** - navigation only, no status. The router's `Route` catches it as dev's does above.
- **The `<Redirect>` component is deleted.** Its one legitimate job, redirecting during render, moves to the throw; `goto` covers the rest. Breaking: `minor`, with migration lines - `<Redirect to>` → `throw new Redirect(to)`; `when={x}` → an `if`; `replace` → the cold-load rule above.
- **The `redirect` prop** keeps working: a route's cached verdict fires `goto` once per verdict, not on every re-render of `frame()`.
- **AGENTS.md's guardrail** names the `redirect` prop; it adds the `Redirect` error, and the component leaves the router's listed contract.
- **dev's `Route` accepts both** the router's `Redirect` and rpc's, extending the router's catch. dev re-exports rpc's, which works on the server too.
- **Two classes named `Redirect`, never in one app's imports:** router-only apps import the router's, dev apps import rpc's through dev. rpc can't extend the router's without depending on a client-only package.
- **Its own PR, against `main`, in either order.** dev handles rpc's `Redirect` in its own `Route` regardless; accepting the router's is additive once that ships.

## Implementation notes

- **The gate check keeps `enter`.** Apps lose the entry hook, but dev's gate check is built on it: `enter`, `arm`, `REFUSED` and `retry` in `client/route.tsx`, `checked()` in `check.ts`, and `hookOf`/`hook` in `vite/routes.ts`. `enter` stays as internal plumbing for gated folders; only the app-facing function `default` goes. `stay(error)` strips `location` from a refused gate's redirect to force `Catch`, but the error is still `instanceof Redirect` - the `Redirect` branch checks `error.location` too.
- **Placing a pre-built `default`.** A Component instance placed as `{instance}` gets its `children` written with `instance.set({ props: { children } })` when the route's content changes - never from the route's `render()`, which loops. The route's `new()` returns its cleanup synchronously; awaiting readiness happens inside it.
- **Console noise.** Render-time throws reach a boundary, and React logs what boundaries catch: dev's React root filters `Redirect` and `NotFound` through `onCaughtError`. mvc warned when a factory or getter threw on its first read, though the error also reaches the reader; #834 drops that warning, so a guard's throw prints nothing.
- **Calls from the entering tree.** `pathOf` fills params from `location.pathname`, which is still the old URL during a hold; `entering()` covered hooks only. Calls fill from `Router.path` instead.
- **Codegen keyed on `Page`.** `pagePatterns` (the server's 404), `staticPaths`, `renders` and the gate tree in `vite/routes.ts` all count a leaf `default` as a page. `wrap()` renders a function `default` as a component, not bare `children`. A leaf whose `default` is a Model and which has no `Page` renders nothing - generation warns.
- **Hot reload.** An edit to `new()` reloads the instance rather than patching it, so a guard edit reloads the route. A hot update settles a route's caught error, so a fixed page replaces its `Catch`.
- **dev's `Redirect` changes meaning.** The root re-export was the router component; it becomes the error. Rendering `<Redirect to>` from dev fails with a message pointing at `throw new Redirect(to)`.
- **Docs.** dev README lines 11, 35, 42, 137, 151, 264, 552, 564, 629, 648, 668, 738; dev skill lines 16, 22, 44, 46, 50, 71, 74, 99, 146, 274; router skill lines 21, 29, 309-315. They switch to dev imports and the new exports, and the skill's "two `Redirect`s" warning goes.

## One import source

rpc and the router are dev's implementation, not the app's dependencies.

| Need | From |
| --- | --- |
| `Route`, `Router`, `Link`, `NavLinks` | `@expressive/dev` (already) |
| `Redirect`, `NotFound`, `HttpError` and the rest of the family | `@expressive/dev` and `@expressive/dev/server`, re-exported from rpc |
| `Current`, `Cookies` | `@expressive/dev/server` (already) |
| `Env` augmentation | `@expressive/dev` (already) |

Neither package is in the app's `package.json`. A direct import resolves only through hoisting, and the docs never show one, so no enforcement is planned. `@expressive/mvc` stays the app's peer.

`Route.get().match` stays `| undefined`: a folder route - what a `default`, `Layout` or `Catch` reads - has no match of its own while rendered. A leaf page reads `match!`.

## Migration (unreleased trunk, plus 0.5)

| Before | After |
| --- | --- |
| `export default (route) => "/login"` (entry hook) | `throw new Redirect("/login")` in the `default`'s `new()` (it may `await`), or in the page while rendering |
| hook returning `null` | `throw new NotFound()` |
| `<Redirect to="/x" />` | `throw new Redirect("/x")` |
| `<Redirect when={x} to="/x" />` | `if (x) throw new Redirect("/x")` |
| `export function NotFound` in a route module | `Catch` handling `error instanceof NotFound` |
| `Redirect` / `Forbidden` from `@expressive/rpc` | from `@expressive/dev` (or `/server`) |
| a leaf's `export function Page` | `export default` (`Page` still works) |
| `default` class wrapping `Layout` | unchanged |

A function `default` can't be told apart from a 0.5 entry hook by shape - a wrapper declares `props` to place `children`, and a leaf page may take props too. Generation fails only on a parameter named `route`; at runtime, a function `default` returning a string fails, naming the module and pointing here. `minor`, pre-1.0.

## Queued

- **Params as index exports.** `[param]` and `[...]` files folded into the folder's `index` as exports receiving their match, like `Catch`. That makes the index define several pages - `Page`, the param page, the rest page - which is why `Page` stays a full export.
- **`(route).ts` against `_private.ts`** for marking routes and helpers, across `app/`, `api/` and MDX.

## Follow-up

- **Holding the screen through a redirect.** A host seam turning a `catch()` outcome into a suspension in a passive pass, so a thrown `Redirect` keeps the held screen up until its target is ready instead of showing the fallback. New behaviour in dom and the React adapter, with its own sign-off. Tracked on the board.

## Open questions

1. **Preact compat and a pre-built Component.** A Component instance placed as `{instance}` renders nothing under compat; a Model `default` works. Fix in the adapter, or build a Component `default` in the tree under compat.
2. **Prerender noise.** A redirect at build warns for every self-gated page on every build. A quiet skip may suit better.
3. **An index `default` ignoring `children`** hides the whole folder. A dev warning is possible.

## New public surface

- `Redirect`, `NotFound` and the `HttpError` family re-exported from `@expressive/dev` and `@expressive/dev/server`.
- `@expressive/router`: a `Redirect` error; the `<Redirect>` component removed.
- mvc (#834, its own PR): no warning when a factory or getter throws on its first read.
- Behaviour: the route builds its `default` before render; route nesting `default` → `Layout` → `Page`; a leaf's `default` is its page; the app-facing entry hook and the `NotFound` route export removed; dev's `Route` catches `Redirect` and `NotFound`, and a `Model.on({ catch })` policy routes `setup` reports carrying them.

# A route module's default is its page

Design note for `@expressive/dev`'s route modules under `app/`. Lands on the `feat/dev-serve` trunk beside the server entry, so apps port once.

## Why

Today a route module's `default` is read by kind: a function is the entry hook, a Model or Component class wraps the route's content and is provided below it, and the page itself is a separate `Page` export. In a real port this read wrong:

- Most route modules want to default-export the page. `export default` meaning "a hook" or "a wrapper" is the surprise.
- A wrapper class mounts for every visitor. A page whose state loads a signed-in profile (`account = set(auth.profile)`) can't be that wrapper without failing signed out, so the port split it into a `state.ts` mounted after a check in `Page`.
- Redirect and 404 have several spellings: a hook's returned string or `null`, `<Redirect to>` while rendering, and rpc's `throw new Redirect()` in gates - two different classes named `Redirect`.

## Settled

- **`default` is the page.** A function component or a Component class. `Page` is no longer read; a module still exporting one fails generation, naming the file.
- **A Model `default` is the route's controller.** Provided around the `Layout` and page; renders nothing.
- **`Layout` keeps wrapping.** A default wraps nothing but its own content.
- **No entry hook, no throws.** A page decides what to show by rendering; neither a function page nor a class's `new()` throws to redirect or 404.
- **Redirect is `<Redirect to>`.**
- **A page's 404 is a component it renders.** The folder's `NotFound`, imported like any component.
- **404 as a status covers unmatched URLs only.** Whether a page can produce a formal 404 waits for server rendering, later in the product cycle.
- **A dev app imports nothing from `@expressive/rpc` or `@expressive/router`.**

## Pages

| `default` is | Means |
| --- | --- |
| A function component | The page. |
| A Component class | The page. Its instance is provided below, so the page's sections call `X.get()`. |
| A Model (not a Component) | The route's controller, provided around the `Layout` and page. |

An imported default is told apart when the route loads, as now. A plain class that is neither fails, naming the file.

Sections import the page class from `./index`. That is a cycle, but a safe one: the class is read at render, never at module scope.

## Deciding what to show

A page renders its outcome. Nothing throws.

```tsx
// app/card/[id].tsx
import { Redirect, Route } from "@expressive/dev";
import { NotFound } from "./index";

export default function Card() {
  const { me } = Session.get();
  const { match } = Route.get();
  const cards = Cards.get();
  const card = cards.find(match.id);

  if (!me) return <Redirect to="/signin" />;
  if (!card) return <NotFound />;

  return <CardView card={card} />;
}
```

- **`<Redirect to>`** navigates; on an in-app navigation the incoming page renders behind the held screen, so the redirect never flashes it.
- **`<NotFound />`** is the folder's own component, from its `index.tsx`, or dev's root `NotFound` (the default) when the folder defines none. It is a render state: the URL stays, and the page re-renders out of it when the record arrives.

### State that needs a precondition

State is constructed only where its precondition holds, so it never guards itself:

- **Composition.** The stateful part mounts only on the path where it can load:

  ```tsx
  // app/me/index.tsx
  export default function Page() {
    const { me } = Session.get();

    if (!me) return <Redirect to="/signin" />;

    return <Me />;
  }

  export class Me extends Component {
    account = set(auth.profile);
    render() { … }
  }
  ```

- **Ownership.** Whoever knows the precondition constructs the dependent model - `Session` owns `account = set(() => this.me && new Account())`, which exists only while signed in and goes away on sign-out, so a page reading it re-renders into its redirect.

## `NotFound` exports and status

The folder's `NotFound` export stays, for the one case a page can't cover: a URL under the folder that matches no route (`/card/a/b/c`). No page renders there, so the folder supplies its 404 up front, mounted as its `none` route; dev's root `NotFound` is the fallback.

| Case | Who decides | Rendered | Status |
| --- | --- | --- | --- |
| The URL matches no route | the router | the folder's `NotFound` export, automatically | 404 - the server sees the path (page patterns in each entry) |
| The page exists, its data doesn't | the page | the same component, rendered by the page | 200 - a render state |

In an SPA the server never sees whether a record exists, and a prerendered page is fixed at build, so a page-level 404 status would be inconsistent across hosts. Crawlers see a soft 404 for missing records until server rendering with data exists.

## One import source

rpc and the router are dev's implementation, not the app's dependencies. Everything an app touches comes from dev:

| Need | From |
| --- | --- |
| `Route`, `Router`, `NotFound`, `Link`, `NavLinks`, `Redirect` | `@expressive/dev` (already) |
| `HttpError`, `Forbidden`, `Unauthorized`, the rest of the family - for gates and calls | `@expressive/dev`, re-exported from rpc |
| `Current`, `Cookies` | `@expressive/dev/server` (already) |
| `Env` augmentation | `@expressive/dev` (already) |

- The trunk's README and skill break this today: `Forbidden` and `Redirect` from `@expressive/rpc` in the api/ and gate-check recipes (README lines 137, 151, 629, 648; skill lines 74, 99). They switch to dev imports, and the skill's "two `Redirect`s" warning goes. rpc's own docs keep their imports for apps without dev.
- Both packages are hoisted into `node_modules`, so a direct import still resolves. dev's plugin warns when an app module imports `@expressive/rpc` or `@expressive/router`, naming the dev export to use. `@expressive/mvc` stays the app's peer (`Model`, `Component`, instructions).
- A gate's `Redirect` (the rpc error, a 3xx with `location`) and dev's `Redirect` (the router component) would share a name in one import. The error re-export needs a distinct name - for example `Redirection` - settled in the implementing PR.

## Types

- `Route.get().match` becomes non-optional - the docs read params from it, and a page only renders when its route matched.

## Migration (unreleased trunk, plus 0.5 hooks)

| Before | After |
| --- | --- |
| `export function Page` | `export default` |
| `export default (route) => "/login"` (entry hook) | `<Redirect to="/login" />` rendered by the page |
| hook returning `null` | the page renders `<NotFound />` |
| `export default class X extends Model` (wrapper) | unchanged: the controller |
| `export default class X extends Component` (wrapper rendering children) | the page itself; a wrapper becomes `Layout` |
| `throw new Redirect(...)` from rpc in a gate | the same error, imported from dev |

A function default can't be told apart from a 0.5 entry hook by shape, so this is a clean break (`minor`, pre-1.0). Generation catches the common case: a function default that declares a parameter (a hook's `route`) fails, naming the module and pointing here.

## Open questions

1. **A Model controller beside a Component page.** Only one default: a route needing both makes the Component the page and owns the state there. Is a Model controller default still needed once Component pages are the norm?
2. **The gate error's name.** `Redirect` is the router component in dev's root; the re-exported rpc error needs another name, or gates keep a dev-specific spelling.
3. **The plugin warning's strength.** Warn, or fail the build, on a direct `@expressive/rpc`/`@expressive/router` import.

## New public surface

- `HttpError` and its subclasses re-exported from `@expressive/dev`.
- Behaviour: a route module's `default` is the page; `Page` and the entry hook removed; `Route.get().match` non-optional; dev's plugin warns on direct rpc and router imports.

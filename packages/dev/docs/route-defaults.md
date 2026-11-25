# A route module's default is its page

Design note for `@expressive/dev`'s route modules under `app/`, for sign-off before any implementation. Lands on the `feat/dev-serve` trunk beside the server entry, so apps port once.

## Why

Today a route module's `default` is read by kind: a function is the entry hook, a Model or Component class wraps the route's content and is provided below it, and the page itself is a separate `Page` export. In a real port this read wrong:

- Most route modules want to default-export the page. `export default` meaning "a hook" or "a wrapper" is the surprise.
- The hook and a controller can't both be the default, so state that guards its own page splits across a hook, a wrapper and a `Page`.
- A wrapper class mounts for every visitor. A page whose state loads a signed-in profile (`account = set(auth.profile)`) can't be that wrapper without failing for signed-out visitors; the port moved it into a `state.ts` mounted after a check in `Page`.
- Redirect and 404 have three spellings: a hook's returned string or `null`, `<Redirect to>` while rendering, and rpc's `throw new Redirect()` in gates - two different classes named `Redirect`.

## The rule

| `default` is | Means |
| --- | --- |
| A function component | The page. |
| A Component class | The page. Its instance is provided below, so sections call `X.get()`. |
| A Model (not a Component) | The route's controller: provided around the `Layout` and page, rendering nothing. |

- `Layout` keeps wrapping. A default no longer wraps anything but its own content.
- `Page` goes. A module exporting both `default` and `Page` fails generation, naming the file.
- An imported default is still told apart when the route loads.

## Guards: `redirect()` and `notFound()`

Two functions from `@expressive/dev`'s root, typed `never`, so code after them narrows. Each throws; the route that is rendering catches it:

- `redirect(to)`: navigate there, replacing the entry. A redirect back into the same folder lands in `Catch`, as gate checks do.
- `notFound()`: the folder's 404 - its `NotFound` export, else the nearest above. The URL stays.
- Anything else thrown: `Catch`, as today.

They work wherever the route is deciding what to show:

- **A function page, while it renders.** On an in-app navigation the incoming page renders behind the held screen, so a redirect or 404 never flashes the page. On a cold load nothing of the page has painted yet.
- **A page or controller class, in `new()`.** The instance is created during the navigation while the current screen holds, and the route waits for `new()` before rendering - so data a guard needs (`await this.session`) is loaded first.
- **A server gate or call.** They throw rpc's `Redirect` and `NotFound`, which answer their HTTP status, and the gate check maps on the client as now. One spelling on both sides.

Outside those - an event handler, an effect after mount - there is no route deciding, and the throw would surface as an error. Navigation there stays `Route.get().goto(to)`. The skill says so beside the functions.

Returning `null` stays "render nothing", never a 404. `<Redirect to>` stays the router's, under its stability contract, but a dev app no longer needs it: `redirect()` covers render-time redirects too.

```tsx
// app/me/index.tsx - a class page that guards itself
import { Component, get, set } from "@expressive/mvc";
import { redirect } from "@expressive/dev";

export default class Me extends Component {
  session = get(Session);
  account = set(auth.profile);

  protected new() {
    if (!this.session.me) redirect("/signin");
  }

  render() {
    return (
      <SubPage title="Me">
        <Tabs />
        <View />
      </SubPage>
    );
  }
}

// app/me/Profile.tsx - sections import the page class
import Me from "./index";
export const Profile = () => <Heading>{Me.get().account.name}</Heading>;

// app/card/[id].tsx - a function page with a guard
import { notFound } from "@expressive/dev";

export default function Card() {
  const card = Cards.get().find(Route.get().match.id);

  if (!card) notFound();

  return <CardView card={card} />;
}
```

Sections importing the page class from `./index` is a cycle, but a safe one: the class is read at render, never at module scope.

Why not `throw "/signin"` or `throw null`: TypeScript accepts both (only the `no-throw-literal` lint rule objects), but dev would then have to read every thrown string as a navigation and every thrown `null` as a 404, so a library's stray `throw "message"` or an accidental `throw null` would navigate instead of reaching `Catch`. In a gate, a thrown string is a 500. And `redirect("/signin")` names its intent; the literal needs the reader to know the convention.

## A dev app never imports `@expressive/rpc`

rpc is dev's implementation, not the app's dependency. Everything an app touches comes from dev:

| Need | From |
| --- | --- |
| `redirect`, `notFound` | `@expressive/dev` |
| `HttpError`, `Forbidden`, `Unauthorized`, the rest of the family | `@expressive/dev`, re-exported from rpc |
| `Current`, `Cookies` | `@expressive/dev/server` (already) |
| `Env` augmentation | `@expressive/dev` (already) |

The trunk's own README and skill break this today: `Forbidden` and `Redirect` come from `@expressive/rpc` in the api/ and gate-check recipes (README lines 137, 151, 629, 648; skill lines 74, 99). They switch to dev imports, and the skill's "two `Redirect`s" warning goes. rpc's own docs keep their imports for apps without dev.

## Migration (unreleased trunk, plus 0.5 hooks)

| Before | After |
| --- | --- |
| `export default (route) => "/login"` (entry hook) | `redirect("/login")` in the page, or in a class's `new()` |
| hook returning `null` | `notFound()` |
| `export default class X extends Model` (wrapper) | unchanged: the controller |
| `export default class X extends Component` (wrapper with `render()` around children) | the page itself; a wrapper becomes `Layout` |
| `export function Page` | `export default` |
| `<Redirect to>` in a page | `redirect(to)` (the component still works) |
| `throw new Redirect(...)` from rpc in a gate | `redirect(...)` from dev |

A function default can't be told apart from a 0.5 entry hook by shape, so this is a clean break (`minor`, pre-1.0). Generation can catch the common case: a function default that declares a parameter (a hook's `route`) fails, naming the module and pointing here.

## Open questions

1. **Creating the instance before render.** dev's Route builds the default class during the held navigation, then mounts the page from that instance. Needs confirming that mvc and dom mount an existing instance cleanly - placement, `fallback`, `catch`, hot reload - or a seam to do so.
2. **Catching render throws.** dev's Route intercepts `redirect()`/`notFound()` before the folder's `Catch`. Confirm this composes with dom's held transitions and suspense - a guard throw from a page that also suspends - and with React under the compat host.
3. **Model controller beside a Component page.** Only one default: a route needing both makes the Component the page and owns the state there. Is a Model controller default still needed once a Component page is the norm?
4. **`redirect()` options.** `replace` by default (a guard's bounce shouldn't stay in history); a `push` option, or not.
5. **Status on the server.** `notFound()` in a page renders the folder's 404 on the client. On prerender or a server render of that path, should it answer 404, and should `redirect()` answer 3xx? Today an unmatched navigation gets the shell with 404; a matched route that 404s from its guard gets 200.

## New public surface

- `redirect(to)` and `notFound()` from `@expressive/dev`.
- `HttpError` and its subclasses re-exported from `@expressive/dev`.
- Behaviour: a route module's `default` means the page; `Page` removed.

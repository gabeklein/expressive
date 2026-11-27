# Calls in `/api`

A design note on moving `@expressive/dev`'s typed server calls out of `app/**/remote` and into `/api` modules, next to the HTTP verbs. With this change `app/` holds only frontend code, and `/api` is the single place server code lives.

## The recipe

What a new user reads once this lands.

```ts
// api/(account).ts
import { Current } from "@expressive/dev/server";

export const GET = () => account();            // REST: GET /api/account, for anyone

export async function account() {              // call: the app imports it
  return Session.get().user;
}

export async function rename(name: string) {   // call
  return db.user.rename(name);
}
```

```tsx
// app/me/index.tsx
import { Component, set } from "@expressive/mvc";
import { account, rename } from "../../api/(account)";

export default class Me extends Component {
  user = set(() => account());
}
```

- **A route module in `/api` serves two kinds of export.** Uppercase verbs (`GET`, `POST`, and the rest) are HTTP handlers. Any other exported async function is a call.
- **The app imports calls directly.** The client gets typed stubs, and the function runs on the server.
- **Folder gates cover both kinds.** A refused call rejects with the gate's error, and a route's `default` that awaits it can turn that into a `Redirect`.
- **Helpers stay private:** bare names, `_` files, tests. The client can't import them.

## The wire

- A call is a `POST` to its module's own path: `api/(account).ts` posts to `/api/account`, and `api/admin/index.ts` posts to `/api/admin`.
  - It carries the `x-expressive-call` header naming the function (`rename`) and a JSON array of arguments. The reply is `{ value }`, as now.
- The header is what separates a call from a REST `POST` at the same URL. A request without it goes to the module's `POST` verb, if there is one.
- In production, the header carries a per-build hash instead of the function's name, as remote calls do today. `remote: { opaque: false }` keeps the names readable.
- Only functions the client build imports are callable. An exported function that no client code imports isn't an endpoint. This is today's sidecar rule, carried over.
- Calls are always `POST`. GET is never inferred from parameters, because a call's shape says nothing about whether it's safe: `logout()` takes nothing and still mutates. Export `GET` to serve a GET.

## Rules

- **Calls live on static paths only.** A call module under a `[param]` or `[...]` path has no page URL to fill those segments from, so it's a build error. A call that needs an id takes it as an argument.
- **What a route module may export:** verbs, `default` (a gate in an `index`, a catch-all elsewhere), async function calls, `Error` subclasses (thrown on the server, rethrown as the same class on the client, as remote calls do today), and types. Anything else is a build error. Move it to a helper.
- **What the client may import:** from a route module, its calls (as stubs), its `Error` subclasses and its types. Importing a verb, a `default`, or anything from a helper is a build error.
- **What a call can use:** everything a sidecar call has today. That includes `Current`, cookies, gate Models in context, typed errors, and gates with `next`.
- **Standalone `@expressive/rpc`**, with its own folder plugin and no dev, is unchanged.

## What goes

- **`app/**/remote.ts` and `remote/` sidecars.** `app/` becomes frontend only.
- **The gate check.** It probed a server twin of each gated `app/` folder before entering it. Under #833's model, a route's `default.new()` awaits an `/api` call to load or guard itself. That call runs the `/api` gates, and a refusal reaches the route as an error, so the data load is the check. This removes `gateCheck`, the entering-path holder and the `/routes` subpath (#828).
- **Implicit params from the page URL.** Calls take explicit arguments instead.
- **The `+` server marker in #852.** That note shrinks to `_` for private files and params from props.

## Provisional: verb params from the signature

This is to be checked once the call spike is done. A verb's parameters are path segments:

```ts
// api/(user).ts
export async function GET(user: string) {}     // GET /api/user/:user
export async function POST() {}                // POST /api/user
```

- **How they're read:** at build time, from the source. dev already parses every `api/` module for the verb guard. A runtime `fn.length` would see required parameters only: `?`, default values and rest all read as 0, and a wrapped handler reports its wrapper's arity.
  - **Required, optional and rest:** `GET(id)` takes one segment, `GET(id?)` takes zero or one, and `GET(...path)` takes the rest, which would retire `[...].ts`.
  - **Names:** they're kept, so `Current.get().params.user` and error messages work.
- **Dispatch is by method plus segment count.** A count that matches no handler for its method gets a 405 if another verb fits that count, otherwise a 404.
- **Values are strings, typed as declared.** A non-`string` annotation is a build error.
- **Wrapped verbs:** `export const GET = staff(handler)` with parameters is a build error ("declare them on the function, or read `Current.get().params`"). A wrapped verb with no parameters keeps working.
- **Static beats param.** `api/user/settings.ts` serves `/api/user/settings` ahead of `GET(user)`.
- **Gates still see only their own folder's params.**
- **Folders all of whose routes sit below an `:id`** are still an open question, shared with #852's folder params.

One documentation point: in one module, `GET(user)` gets its argument from the path, while `rename(name)` gets it from the body. The uppercase name is the only difference.

## How it lands

These are trunk PRs, each with a Fable review:

1. **Calls in `/api`.**
   - The scan that classifies exports.
   - Call dispatch beside the verbs, using the header.
   - Client stubs and the new import rule.
   - Gates covering calls.
   - The callable set taken from what the client imports.
   - Prerender's call stub.
2. **Removing `app/` sidecars.**
   - The rpc manifest built from `app/**/remote`.
   - The gate check, and `/routes` (closing #828).
   - The example app and the hot-probe sidecar fixture move to `/api`.
3. **The rest.**
   - #852 narrowed.
   - The README, skill and design notes.
   - Both dogfood ports moved.

The verb-param part follows as its own PR if the spike holds up.

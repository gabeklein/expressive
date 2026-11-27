---
"@expressive/dev": minor
---

`app/` is frontend only. Sidecars - `app/**/remote.ts` and `remote/` folders - are removed: server calls live in `api/` route modules, and a `remote.ts` or `remote/` left under `app/` fails generation, naming the `api/` module to move it to. Folder gates are `api/` index defaults, run before each call and verb below them. A page guards itself in its route `default`'s `new()` by awaiting an `api/` call - a refusal throws to `Catch`, and a `Redirect` navigates. The gate check that probed a gated `app/` folder before entering it goes with them, as do `gateCheck` and calls taking params from the page URL: a call takes an id as an argument. Prerender no longer skips folders - a page whose `default` awaits a call renders in the browser.

# Route file naming

Design note on how `@expressive/dev` reads file and folder names in `app/` and `api/`. It follows #833 (route exports, redirects and not-found) on the `feat/dev-serve` trunk, and assumes #833's export model: `default` → `Layout` → `Page`, with redirects and not-found as thrown errors.

## The recipe

What a new user reads once this lands.

```
app/
  index.tsx          /
  about.tsx          /about
  photo.tsx          /photo and /photo/:id      export default function Photo({ id }: { id?: string })
  docs.tsx           /docs/*                    export default function Docs({ path }: { path: string[] })
  room.tsx           /room
  room/              /room/:id and below        room/index.tsx: export default function Room({ id }: { id: string })
    chat.tsx         /room/:id/chat
    +calls.ts        server calls for /room/:id; its default is the folder's gate
    +calls/_db.ts    server-only helper, not a call
  _ui/               private: components, helpers, fixtures - never routes
  format.test.ts     tests are never routes
```

- **A plain name is a route.** `about.tsx` serves `/about`. No parens.
- **`_` makes a name private.** The file or folder is never a route, and neither is anything below it.
- **`+` marks server code**, for a file or folder and everything below it.
  - Its exported functions are calls the page imports. The client gets typed stubs, and the code runs on the server.
  - A folder's `+` module `default` is the folder's gate.
  - It replaces `remote.ts`.
  - `_` inside `+` is server code that isn't exposed as a call.
- **A page's params are its props.** Whatever the page function destructures becomes path segments, in order.
  - An optional prop is an optional segment.
  - An array rest (`path: string[]`) takes the rest of the path.
  - A page that takes nothing serves only its own path, so `/about/x` is still a 404.
- **A folder takes a param through its index.** When `room/index.tsx`'s `default` takes `id`, the folder is `/room/:id` and everything in it sits below that. `room.tsx` beside it serves `/room`.
- **Static beats param.** With `photo.tsx` taking an optional `id` beside `photo/new.tsx`, `/photo/new` is the new page and `/photo/abc` is the photo.

`expressive routes` prints the URL table, so the map is one command away.

## Why

- **Colocation.** Helpers, tests, server calls and their server-only helpers sit beside the UX that uses them. Today `api/` helpers and sidecar logic drift into a separate `server/` folder. In two dogfood ports, the route modules were thin and the logic lived elsewhere.
- **One rule for code and content.** `_` is the familiar opt-out: Next private folders, Astro, Jekyll, Sass partials. An MDX tree reads the same way: every file is a page unless it starts with `_`. Parens can't carry over to MDX (`(about).mdx`).
- **Fewer marks.** Brackets and parens go. What remains is `_`, which is rare, and `+`, once per folder that has calls.
- **Params where they're used.** The page declares what it reads and gets it typed. Today a `[slug]` file name and a `Route.get().match.slug` read have to agree by hand.

## Rules in full

### Names

| Name | Meaning |
| --- | --- |
| `name.tsx` / `name.ts` | A route at `name`, if its exports make it one (below) |
| `index.tsx` | The folder's own path. Its `default` signature can make the folder a param scope |
| `name/` | A scope at `name` |
| `_name`, `_name/` | Private to the router, at and below |
| `+name.ts`, `+name/` | Server code, at and below. Exports are calls; the folder's gate is a `+` module's `default` |
| `*.test.*`, `*.spec.*`, `*.d.ts` | Never routes |

A file in `app/` is a route when it exports `default`, `Page` or `Layout`, per #833. A plain file that exports none of them is a support module. So a shared `format.ts` doesn't become a route, and `_` is only needed where a file looks like a route but shouldn't be one.

### Params

- **Read from the function that renders the page:** a function `default` or `Page`, in the route file itself. The build reads it from the source. Vite's parser gives each parameter's name, whether it's optional, its default value, and rest.
- **A destructured first argument.** A prop without a default is a required segment. A `?` or a default value makes it optional. A single `string[]` prop, last, takes the rest.
- **A class `default` has no signature to read.** A leaf that needs params alongside class state exports `Page` beside it, and `Page` declares them.
- **An imported page has no local signature,** so it takes no params, and a build error says to declare it in the route file.
- **Folder params are read the same way,** from `index.tsx`'s `default`. The folder's pages, `+` calls and gate all see them: as props on the page, and as `Current.get().params` on the server.
- **Values are strings, typed as declared.** Parsing to `Number` or a date stays the page's job, as it is today.

### Generated routes

- An optional segment is emitted as two routes sharing one page (`photo` and `photo/:id`), so the router needs no optional-param syntax.
- Within a scope, static children come before params, so `/photo/new` wins.
- Gate checks, server 404s, prerender and call addressing all take their patterns from this one table.

### `api/`

The same rules apply: `_` is private, plain names are routes, and tests are skipped.
- Handlers take params like pages: `export const GET = ({ id }: { id: string }) => …`. `Current.get().params` stays as a fallback.
- `+` has no meaning in `api/`, since everything there is already server code.

### MDX, elsewhere

The same `_` rule: every `.mdx` file is a page unless it, or a folder above it, starts with `_`. Today nothing excludes MDX partials; the website's prerender and sitemap glob `**/*.mdx`.

## Open questions

1. **`+` or `$` for server code.**
   - `$` was the first proposal, but shells expand it: `cat app/$photos.ts` reads `app/.ts` unless quoted. That trips up every terminal command, for people and agents alike. Remix also used `$id` to mean a param.
   - `+` has neither problem and is SvelteKit's marker for framework files.
   - The tooling here handles both: Vite, Rollup and tsdown resolve them, and Rollup rewrites both to `_` in emitted file names.
   - **Recommend `+`.**
2. **Params as props, or as positional arguments.**
   - Positional (`Photo(id?: string)`) reads most directly. But dom and React call a function component with props as the first argument, so a positional page stops being a component.
   - The generated tree would have to call it specially, and a test couldn't render `<Photo id="1"/>`.
   - **Recommend props.**
3. **Folder params through `index.tsx`, or keep `[id]/` for folders.**
   - The index route keeps the tree free of brackets and puts the param where the folder's state lives.
   - It costs visibility: the folder name alone no longer shows a param, and bare `/room` moves to a sibling `room.tsx`.
   - Keeping `[id]/` for folders only is more visible, but one bracket form survives.
   - **Recommend the index route,** with `expressive routes` and dev's 404 hints covering visibility.
4. **Several `+` files in one folder.**
   - They share the folder's address.
   - **Recommend:** only `+index.ts` or `+/index.ts` may export the gate `default`; a `default` on any other `+` file is a build error.
5. **Feature-local HTTP.** A `+` module could export verbs, served under `/api/<path>`, which would fold `api/` into `app/`. That's the next colocation step, left out of this cut.

## Migration

A clean break on the trunk, pre-1.0, after #833. Old names fail generation and say what each became:
- `(about).tsx` → `about.tsx`
- `[id].tsx` → a prop
- `remote.ts` → `+remote.ts`

Current footprint: 60 dev unit cases, 3 e2e cases across 2 specs, 17 example files, 1 hot-probe scenario, and the README and skill sections on routes and sidecars.

Code that changes:
- `vite/routes.ts`: the tree walker, the classifier and sidecar discovery.
- `vite/api.ts`: `api/`'s scan.
- `vite/scan.ts`: gate ownership and diagnostics, plus the signature read beside `label` in `scanExports`.
- `vite/plugin.ts`: the client resolver's prefilter and the optimizer globs.
- `vite/project.ts`: the project scan.

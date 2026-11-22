---
"@expressive/dev": minor
---

`config({ fetch })` in `index.ts` gives the app its own routes, after remote calls and before static files, in the request's scope - on Node, in a build and in `expressive dev`. `config({ target: "fetch" })` builds `dist/server/index.js` as `export default { fetch }` with every dependency bundled, for a host that calls a module's `fetch`: remote calls, then the app's `fetch`, else 404. Static files are the host's, forwarded by the app's `fetch`. The config's other members join the default export and `index.ts`'s named exports are re-exported; a named `bindings` export supplies `env` in dev and is left out of the build. The target serves remote functions only - a remote that default-exports a seat or exports a Model class fails the dev server and the build.

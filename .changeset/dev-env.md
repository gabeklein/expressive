---
"@expressive/dev": minor
---

`.env` built in: `env` re-exported from `@expressive/dev` (prefixed keys in the browser), the same files fill `process.env` in dev, during `dev build` and at the built server's boot (`registerEnv` from `@expressive/dev/server` for scripts), Vite's mode follows `NODE_ENV`, and `expressive env` joins the command. `--no-env` on `expressive dev` and `dev build` turns it off. The built server's `dist/server/index.js` is now a boot file that defaults `NODE_ENV` to `production` and imports the app from `dist/server/app.js`.

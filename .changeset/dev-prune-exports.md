---
"@expressive/dev": minor
---

Remove exports with no use outside dev itself.

- `hydrate` leaves the root - import it from `@expressive/dom`.
- `runDev` and `DevOptions` leave `@expressive/dev/vite` - run `expressive dev`, or add `expressive()` to a Vite config and start Vite's dev server.

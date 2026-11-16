---
"@expressive/dom": minor
---

`renderToString` from `@expressive/dom/server` renders a node to markup and the style rules it emits, without a DOM. Suspense is awaited in place, effects never run, and owned instances are destroyed afterwards. Options: `signal` stops a render, `markers: false` drops the range comments hydration needs, and `inline: true` writes class rules into `style` attributes for email.

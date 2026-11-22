---
"@expressive/dom": patch
---

Client and server agree on which properties take a bare number: one table, generated from Chrome, replaces the client's DOM probe and the server's shorter list. Server output for properties only the browser knew, like `readingOrder`, no longer gains `px`.

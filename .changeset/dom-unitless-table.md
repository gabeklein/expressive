---
"@expressive/dom": patch
---

Client and server agree on which properties take a bare number - one table generated from Chrome replaces the client's DOM probe and the server's shorter list. Server output for properties the old list missed, like `readingOrder`, and for dashed vendor keys, no longer gains `px`. A `Css` pack keeps numbers bare on custom properties, on the server too.

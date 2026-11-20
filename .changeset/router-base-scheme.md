---
'@expressive/router': patch
---

Resolve and normalize urls against a multi-letter placeholder scheme. Chromium on Windows reads a one-letter scheme as a drive letter, which leaked an `X:/` segment into resolved paths and broke navigation.

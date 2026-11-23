---
"@expressive/mvc": minor
"@expressive/cli": patch
---

Models held in a parent's fields now start after the parent's constructor args, before its `new()`. A child's `new()` sees the props and values its parent was given, and a parent whose args throw never starts its children. A function arg - and Component's `is` - now runs before field children start, so it cannot rely on a child's `new()` having run.

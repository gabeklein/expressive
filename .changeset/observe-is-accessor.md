---
'@expressive/mvc': patch
---

A tracked read of an observable object whose `is` is a getter now runs that getter against the tracking proxy, so a value it returns through `touch` subscribes. Previously every proxy pinned `is` to the untracked value. A Model's `is` still unwraps to the raw instance.

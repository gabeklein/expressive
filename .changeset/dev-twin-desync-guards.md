---
"@expressive/dev": patch
---

Twins hold up better in tabs left open:

- In dev, a field mutated in place (`push`, `set` on a Map) without an assignment warns on the next heartbeat, naming its class and field - its twins are stale until it is assigned.
- A heartbeat that lands while a reply is in flight no longer re-pulls every twin.
- Released twins reach the server within two seconds, without waiting for the tab's next call.

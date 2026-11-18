---
'@expressive/steps': patch
---

A long run holds a fraction of the memory it did and runs faster: a settled step is released while the run continues, keeping only what an unwind needs - a step registering a function handler is kept until the run ends, for the handler. A handler still running when the run ends has its signal aborted. Calling `.catch()` on a step's token after the step which called it settled now throws.

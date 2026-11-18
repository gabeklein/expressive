---
'@expressive/steps': patch
---

`then.commit()` releases the undo state of the steps it descends from, so a long run that commits periodically no longer holds every replaced field value until it ends. A step before a commit now stays applied once a caught failure has unwound past that commit, as `halted` already promised.

---
'@stackmade/gtm-as-code': patch
---

Fixes the first `apply` in a fresh project failing with `ENOENT` on `.analytics/state.json.lock`.
The lock is taken before anything writes the state file, and `writeState` was the only thing that
created `.analytics/`, so the directory did not exist yet. `withStateLock` now creates it.

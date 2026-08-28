---
"@stackmade/gtm-as-code": minor
---

Add `exceptTrigger` on `gtm.tags` entries, mapping to GTM's blocking-trigger mechanism
(`blockingTriggerId`). Works the same way `trigger` already does: validated against declared
triggers, ordered in the dependency graph, applied and read back through `plan`/`apply`/`pull`.

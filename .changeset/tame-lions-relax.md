---
"@stackmade/gtm-as-code": minor
---

Add `gtm.folders` as a new GTM resource kind, with an optional `folder` field on variables,
triggers, and tags. Maps to GTM's `parentFolderId`. Ownership-tracked and dependency-ordered like
any other kind, and supported end to end by `plan`/`apply`/`pull`/`--from-export`.

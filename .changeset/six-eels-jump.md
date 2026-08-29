---
"@stackmade/gtm-as-code": minor
---

Adds `ga4.audiences`: GA4 audience definitions as create/update/archive resources, with a
recursive `and`/`or`/`not`/`dimensionOrMetric`/`event` filter tree. `membershipDurationDays`,
`exclusionDurationMode`, and `filterClauses` are immutable once created; `plan` fails with an
error naming the field rather than attempting a PATCH GA4 would reject. Validation normalizes a
clause's filter into the `and`-of-`or`s shape GA4 requires at the top level, so a single condition
can be written as a bare leaf without knowing about that requirement.

---
"@stackmade/gtm-as-code": minor
---

Adds `ga4.measurementProtocolSecrets` as a stream-scoped create/update/delete resource (config key
is the secret's `displayName`; `secretValue` is server-generated and never in config). Creating one
requires the property's User Data Collection Acknowledgement to already be attested through the GA4
UI. `apply` surfaces GA4's `FAILED_PRECONDITION` with a remediation hint naming that requirement.

`google.ga4.measurementId` no longer has to be set by hand: `plan`/`apply`/`drift` now derive it from
`ga4.streamWebsiteUrl`'s resolved web stream when config leaves it unset.

iOS/Android GA4 data streams are confirmed **not implementable** through the Admin API (it refuses
creation outright, directing callers to the Firebase API instead) and are documented as a hard
blocker rather than left as an open roadmap item.

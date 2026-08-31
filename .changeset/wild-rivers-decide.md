---
"@stackmade/gtm-as-code": minor
---

Adds `ga4.attributionSettings` (`reportingAttributionModel`,
`acquisitionConversionEventLookbackWindow`, `otherConversionEventLookbackWindow`) as a
property-level, settings-diffed field, following the same pattern as `dataRetention` and
`googleSignals`: `plan`/`drift` compare it against the property's live state and `apply` PATCHes
only the fields that changed.

Internal and developer traffic filters are confirmed **not implementable** through the GA4 Admin
API: no `dataFilters`-shaped collection exists under either `v1alpha` or `v1beta`. Documented as a
hard blocker in README and ROADMAP, the same way iOS/Android data streams and Search Console links
already are. This closes out 0.7's GA4 coverage milestone.

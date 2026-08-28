---
"@stackmade/gtm-as-code": minor
---

Add consent settings, consent/PII validation, and protected resources.

- `gtm.tags.*.consent` and `events.*.consent` map to GTM's per-tag `consentSettings`, and a bare
  `consentInit` trigger type is now supported for firing a default-consent tag before everything
  else.
- Validation now fails when a `ga4Event`/`googleTag` tag, or an `events.*` entry (which compiles
  to one), has no `consent` block, and when an event parameter name suggests personal data
  (`email`, `phone`, `address`, and similar).
- `protected: true` on a GTM resource requires `--allow-destroy-protected`, on top of
  `--allow-destroy`, before `apply` deletes it. GA4 resources aren't covered yet.

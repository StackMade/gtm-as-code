---
"@stackmade/gtm-as-code": minor
---

Extend protected resources to GA4. `protected: true` on a `ga4.dimensions`/`metrics`/`keyEvents`
entry now needs `--allow-destroy-protected` before `apply` deletes it, tracked in
`.analytics/state.json` since GA4 has no field of its own to stamp the flag into (GTM resources
already worked this way).

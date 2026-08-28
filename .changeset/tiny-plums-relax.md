---
"@stackmade/gtm-as-code": minor
---

Add a GA4 limits and naming linter to `validate`. Catches reserved event names and prefixes,
reserved parameter names and prefixes, invalid name characters, the 40-character name cap, the
25-parameter-per-event cap, and the 50-event-scoped-custom-dimension-per-property cap, all offline
before `apply` would otherwise hit them mid-run or have GA4 silently reject or scrub the data.

---
'@stackmade/gtm-as-code': minor
---

`gtm-code verify` and `gtm-code doctor`, implementing ROADMAP.md milestone 0.8.

- `gtm-code verify [--days <n>]` queries the GA4 Data API for every declared event over the trailing
  N days (default 28) and reports which ones were never received — the check `plan`/`drift` can't
  give you, since config can match GTM/GA4 exactly while the site never actually fires an event. For
  a received event it also checks whether each `dimension: true` parameter was ever recorded with a
  value; parameters not registered as a custom dimension are reported as unverifiable rather than
  silently skipped, since the Data API has no way to query an arbitrary event parameter.
- `gtm-code doctor` checks config validity, credentials, GTM/GA4 API reachability, and GA4 Data API
  quota headroom, explaining what's missing instead of `plan`/`apply` failing mid-run with a raw
  Google error.

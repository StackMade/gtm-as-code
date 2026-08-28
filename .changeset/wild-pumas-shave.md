---
'@stackmade/gtm-as-code': minor
---

Milestone 0.3: adopt an existing setup.

- `gtm-code pull` reverse-generates YAML from a live GTM container/GA4 property, with
  `--resource <kind>:<id>` for a single resource and `--from-export <path>` to read a GTM UI
  container export instead of calling the API.
- `gtm-code adopt <kind>:<id>` stamps ownership on a resource already pulled into the config, so
  `plan`/`apply` recognize it as managed.
- `gtm-code diff <fileA> <fileB>` compares two config files offline, no network calls.
- `gtm-code drift` checks whether live state has diverged from config, exit 1 if it has — meant
  for a scheduled CI job.
- `googleTag` tags now map `configParameters` and `trigger` correctly, so GA4 configuration tags
  round-trip through `pull`/`apply` without dropping their config parameters or firing trigger.

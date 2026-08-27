---
'@stackmade/gtm-as-code': minor
---

Milestone 0.2: release and safety gates around apply.

- `gtm-code publish` creates and publishes a GTM container version, and `gtm-code rollback`
  republishes the previous one.
- `apply` refuses to run when the GTM workspace has an unresolved sync conflict, and now needs
  `--allow-destroy` on top of `--auto-approve` before it will delete anything.
- GA4 state is tracked in git, guarded by a version check and an apply lock.
- `plan` gained `--format json` and `--format markdown`, plus distinct exit codes for no changes,
  changes pending, and error. The output contract is documented in the README.

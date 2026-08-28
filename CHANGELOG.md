# @stackmade/gtm-as-code

## 0.4.0

### Minor Changes

- 6b2b557: Add `exceptTrigger` on `gtm.tags` entries, mapping to GTM's blocking-trigger mechanism
  (`blockingTriggerId`). Works the same way `trigger` already does: validated against declared
  triggers, ordered in the dependency graph, applied and read back through `plan`/`apply`/`pull`.
- 0e8b4e5: Add `gtm.folders` as a new GTM resource kind, with an optional `folder` field on variables,
  triggers, and tags. Maps to GTM's `parentFolderId`. Ownership-tracked and dependency-ordered like
  any other kind, and supported end to end by `plan`/`apply`/`pull`/`--from-export`.
- b4ad582: Add most remaining GTM trigger, variable, and tag types (page view, click, timer, trigger groups,
  constant, custom JavaScript, lookup/regex tables, cookie, custom HTML, custom image, and more), tag
  firing behavior (`priority`, `firingOption`, `scheduleStart`/`scheduleEnd`, `setupTags`/
  `teardownTags`), and regex matching on custom-event triggers (`eventNameMatchType: 'regex'`).
  Conversion linker and community-gallery template tags, and custom templates, are still not covered.
- b8be458: Add `gtm.builtInVariables` config, so `plan`/`apply`/`drift` can enable GTM built-in variables
  (`Click Text`, `Page Path`, and the rest of the click/page/form/error/history/debug set). It only
  enables variables; one not listed in config is left alone.

### Patch Changes

- 9dd1994: Fix `gtm-code adopt`, which was implemented and tested but never registered in the CLI, so the
  command didn't actually run.

## 0.3.0

### Minor Changes

- 6500c54: Milestone 0.3: adopt an existing setup.

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

## 0.2.0

### Minor Changes

- bf2d78a: Milestone 0.2: release and safety gates around apply.

  - `gtm-code publish` creates and publishes a GTM container version, and `gtm-code rollback`
    republishes the previous one.
  - `apply` refuses to run when the GTM workspace has an unresolved sync conflict, and now needs
    `--allow-destroy` on top of `--auto-approve` before it will delete anything.
  - GA4 state is tracked in git, guarded by a version check and an apply lock.
  - `plan` gained `--format json` and `--format markdown`, plus distinct exit codes for no changes,
    changes pending, and error. The output contract is documented in the README.

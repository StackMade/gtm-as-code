# @stackmade/gtm-as-code

## 0.6.0

### Minor Changes

- fff3ac5: Add `extends:` config composition: a config can pull in `events:`, `gtm.{variables,triggers,tags,folders}:`,
  and `ga4.{dimensions,metrics,keyEvents}:` entries from other YAML files, for shared conventions or
  reusable packs. Resolved in `loadConfig`, so every command supports it automatically. The root
  config always wins over an extends target, and a collision between two extends targets is a
  validation error. Validation errors on merged-in content point at the file and line they actually
  came from.
- f0af425: Add `gtm-code generate`, emitting typed event helpers from `events:`: an `EventName` union, one
  params interface per event, an `EventParams` map, and a `track<E extends EventName>(event, params)`
  function that pushes `{ event, ...params }` onto `window.dataLayer`. Prints to stdout by default;
  `--out <path>` writes it to a file.
- 8680ede: Add `gtm-code docs`, generating a Markdown data dictionary from `events:`: one section per event
  with its description, key-event/consent flags, and a parameter table (type, required, custom
  dimension). Prints to stdout by default; `--out <path>` writes it to a file.
- b9a7764: Add event packs: `packs/ecommerce.yaml` and `packs/recommended.yaml`, `extends:`-able GA4
  recommended events with their GA4-specified parameters. Added a `type: items` event parameter for
  GA4's ecommerce item array; `gtm-code generate` emits it as `Item[]` backed by a shared `Item`
  interface. Also narrowed the reserved-parameter-name lint so `currency` is only rejected when
  marked `dimension: true`, GA4 reserves it for custom dimension/metric creation, not for its own
  recommended events that require it as a standard parameter.
- 623e511: Add a GA4 limits and naming linter to `validate`. Catches reserved event names and prefixes,
  reserved parameter names and prefixes, invalid name characters, the 40-character name cap, the
  25-parameter-per-event cap, and the 50-event-scoped-custom-dimension-per-property cap, all offline
  before `apply` would otherwise hit them mid-run or have GA4 silently reject or scrub the data.

## 0.5.0

### Minor Changes

- 052149c: Extend protected resources to GA4. `protected: true` on a `ga4.dimensions`/`metrics`/`keyEvents`
  entry now needs `--allow-destroy-protected` before `apply` deletes it, tracked in
  `.analytics/state.json` since GA4 has no field of its own to stamp the flag into (GTM resources
  already worked this way).
- 694b6b8: Add consent settings, consent/PII validation, and protected resources.

  - `gtm.tags.*.consent` and `events.*.consent` map to GTM's per-tag `consentSettings`, and a bare
    `consentInit` trigger type is now supported for firing a default-consent tag before everything
    else.
  - Validation now fails when a `ga4Event`/`googleTag` tag, or an `events.*` entry (which compiles
    to one), has no `consent` block, and when an event parameter name suggests personal data
    (`email`, `phone`, `address`, and similar).
  - `protected: true` on a GTM resource requires `--allow-destroy-protected`, on top of
    `--allow-destroy`, before `apply` deletes it. GA4 resources aren't covered yet.

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

# @stackmade/gtm-as-code

## 0.8.3

### Patch Changes

- 2c273f5: Closes the two ways a GA4 write could fail quietly.

  - `apply` reads the four settings objects (`dataRetention`, `googleSignals`, `attributionSettings`,
    `enhancedMeasurement`) back after PATCHing them and compares the fields it asked for. GA4 answers
    some of those writes with a `200` and leaves the property unchanged, and these settings have no
    create/delete lifecycle to fall back on, so the only previous symptom was the next `plan` showing
    the same update again. A mismatch is now named field by field and `apply` exits non-zero, which
    makes the "run `plan` twice around every `apply`" habit unnecessary.
  - `plan` refuses to plan the delete of a key event GA4 reports as `deletable: false`, usually one of
    the default key events a property arrives with. Dropping it from config used to produce a
    `- delete` that failed with `INVALID_ARGUMENT` part-way through every `apply`; it now fails
    offline of the write, naming the key event and both ways out (leave it declared, or unmark it in
    the GA4 UI).

- a2f9323: Removes four workarounds the tool used to push onto whoever ran it.

  - `validate` now rejects a `gtm.variables`/`gtm.triggers`/`gtm.tags` `type` that has no GTM payload
    mapping, with a "did you mean" suggestion, instead of accepting it offline and failing during
    `apply` after earlier resources in the same run were already written to the workspace. The
    supported types live in `SUPPORTED_GTM_TYPES`, next to the mapping that defines them, and a test
    asserts every listed name really maps.
  - A new global `--env <path>` flag, plus automatic pickup of `.env.analytics` or
    `analytics/.env.analytics` when one exists, so the file `init` scaffolds no longer has to be
    sourced into the shell before every local run. A variable already present in the environment is
    never overwritten, so a CI `env:` block still wins. The flag is `--env` and not `--env-file`
    because Node reserves the latter: it scans the whole command line for it and exits with its own
    error before this CLI runs.
  - `apply`/`rollback` decline immediately, naming `--auto-approve`, when there is no terminal to
    answer `Continue? [y/N]`. Previously the prompt waited on a stream that would never send a line,
    so a scripted run hung and Node reported "Detected unsettled top-level await" instead of the
    missing flag. `adopt` declines the same way, but says it only runs interactively, since it has no
    such flag to offer.
  - `apply` takes over a state lock left behind by a process that no longer exists, rather than
    requiring `.analytics/state.json.lock` to be deleted by hand after a run was killed. A lock whose
    pid is still running, or that holds no readable pid (a lock from another machine), is still
    refused.

## 0.8.2

### Patch Changes

- b1d04bf: Fixes four bugs found adopting `@stackmade/gtm-as-code` in a real project:

  - `apply` no longer wipes a hand-written GTM note on `update` — `GtmClient.update` previously
    always overwrote `notes` with just the ownership stamp because the mapping layer never carries a
    `notes` field forward; it now preserves the remote object's existing user-written text.
  - `publish`/`rollback` now request the `tagmanager.edit.containerversions` scope alongside
    `tagmanager.publish` — `workspaces:create_version` checks that scope specifically, and without it
    `publish` 403s even for a service account with full container-edit access.
  - `google.gtm.workspace` can now be set to either a workspace id or its display name (e.g.
    "Default Workspace", as docs and `init` suggest) — `resolveWorkspaceId` looks it up instead of
    assuming it's already an id, and gives a clear error naming the field when neither matches.
  - `plan`/`apply` no longer show a permanent phantom diff for a declared `enhancedMeasurement` field
    set to `false` — proto3 JSON omits `false` fields entirely, so the live value came back as
    `undefined` and compared unequal to `false` forever.

## 0.8.1

### Patch Changes

- 302c04d: Fixes `deepEqual` (used by `plan`/`drift`/`apply` to detect changes) reporting a permanent phantom
  `update` on any GTM resource whose config never sets an optional field: Zod materializes an
  optional key with value `undefined` on the desired side, the remote payload (from `fromGtmPayload`)
  never carries that key at all, and `deepEqual`'s key-count comparison treated the two as different
  objects forever — discovered adopting a real container where every `gtm.variables`/`gtm.triggers`
  entry without a `folder` showed `~ update` with no visible field diff (`printFieldDiff`'s
  `JSON.stringify`-based comparison already treated the two as equal, so the mismatch was silent).
  `deepEqual` now ignores keys whose value is `undefined` on either side before comparing key counts.

## 0.8.0

### Minor Changes

- 2d02443: Adds `ga4.measurementProtocolSecrets` as a stream-scoped create/update/delete resource (config key
  is the secret's `displayName`; `secretValue` is server-generated and never in config). Creating one
  requires the property's User Data Collection Acknowledgement to already be attested through the GA4
  UI. `apply` surfaces GA4's `FAILED_PRECONDITION` with a remediation hint naming that requirement.

  `google.ga4.measurementId` no longer has to be set by hand: `plan`/`apply`/`drift` now derive it from
  `ga4.streamWebsiteUrl`'s resolved web stream when config leaves it unset.

  iOS/Android GA4 data streams are confirmed **not implementable** through the Admin API (it refuses
  creation outright, directing callers to the Firebase API instead) and are documented as a hard
  blocker rather than left as an open roadmap item.

- 31be5a4: Adds `ga4.attributionSettings` (`reportingAttributionModel`,
  `acquisitionConversionEventLookbackWindow`, `otherConversionEventLookbackWindow`) as a
  property-level, settings-diffed field, following the same pattern as `dataRetention` and
  `googleSignals`: `plan`/`drift` compare it against the property's live state and `apply` PATCHes
  only the fields that changed.

  Internal and developer traffic filters are confirmed **not implementable** through the GA4 Admin
  API: no `dataFilters`-shaped collection exists under either `v1alpha` or `v1beta`. Documented as a
  hard blocker in README and ROADMAP, the same way iOS/Android data streams and Search Console links
  already are. This closes out 0.7's GA4 coverage milestone.

## 0.7.0

### Minor Changes

- 8a084f7: Adds GA4 property and stream settings as config: `ga4.dataRetention`, `ga4.googleSignals`, and
  `ga4.enhancedMeasurement.{scrollsEnabled, outboundClicksEnabled, siteSearchEnabled,
videoEngagementEnabled, fileDownloadsEnabled, formInteractionsEnabled}` (the last one scoped to the
  stream found via the new `ga4.streamWebsiteUrl`, which looks up an existing web data stream by URL
  without creating one). These settings have no create/delete lifecycle, so `plan`/`drift`/`apply`
  diff them directly against GA4's live property/stream state rather than treating them as resources.
- e3d02a2: A tag's `trigger`/`exceptTrigger` can now reference GTM's built-in triggers ("All Pages",
  "Initialization - All Pages") by name, resolved to their fixed numeric GTM ids rather than looked
  up in `gtm.triggers`, since GTM never returns these from `triggers.list`. This unblocks a
  `googleTag` tag firing on GTM's own initialization trigger, without pasting a numeric id into
  config.
- 02309d2: Adds `ga4.audiences`: GA4 audience definitions as create/update/archive resources, with a
  recursive `and`/`or`/`not`/`dimensionOrMetric`/`event` filter tree. `membershipDurationDays`,
  `exclusionDurationMode`, and `filterClauses` are immutable once created; `plan` fails with an
  error naming the field rather than attempting a PATCH GA4 would reject. Validation normalizes a
  clause's filter into the `and`-of-`or`s shape GA4 requires at the top level, so a single condition
  can be written as a bare leaf without knowing about that requirement.
- 42c5fcc: Adds `ga4.eventCreateRules`/`ga4.eventEditRules`: GA4 event create/edit rules as create/update/
  delete resources, nested under the web data stream resolved from `ga4.streamWebsiteUrl`. A create
  rule's config key is its `destinationEvent`; an edit rule's config key is its `displayName`. Both
  support a real delete, unlike `ga4.audiences`. An edit rule's `processingOrder` is read-only
  through the API and isn't part of config.

  Adds `ga4.calculatedMetrics`/`ga4.channelGroups`: GA4 calculated metrics and channel groups as
  property-scoped create/update/delete resources. A calculated metric's config key is its immutable
  `calculatedMetricId`; a channel group's config key is its `displayName`, like `ga4.audiences`. Both
  support a real delete.

### Patch Changes

- 93b2393: Fixes `ga4.streamWebsiteUrl` lookup to ignore a trailing slash, and makes its "stream not found"
  error list the web stream URLs that actually exist on the property. `plan`/`apply` also now print
  which GA4 settings changed, not just that some did.
- a9668e7: Adds a remediation hint for `FAILED_PRECONDITION` errors on `ga4.googleSignals`: Google Signals
  must be activated on the property through the GA4 UI once before its state can be changed via
  config. Documents the same requirement in the README.

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

# Roadmap

Where the project is, and what's planned next. Status reflects the actual CLI, not intent.

Milestones are ordered by dependency, not by appeal. Correctness gates come before breadth: a tool
that can express every GTM trigger type but can't safely re-run in CI is worse than one that covers
three trigger types and never destroys anything it shouldn't.

## Done (0.1)

The core loop: declare config, preview, apply.

- `gtm-code init`, to scaffold a project
- `gtm-code validate`, an offline schema check
- `gtm-code plan`, diffing against live GTM and GA4 state
- `gtm-code apply`, which applies the diff and leaves unmanaged resources alone
- GTM: data layer variables, custom event triggers, GA4 event tags, Google tags
- GA4: custom dimensions, custom metrics, key events
- Google auth via ADC, service account, or Workload Identity Federation

Published to npm as `@stackmade/gtm-as-code`, with a companion GitHub Action at
[StackMade/gtm-as-code-action](https://github.com/StackMade/gtm-as-code-action).

## Cross-cutting constraints

Three facts shape everything below, and they are worth stating once instead of repeating in every
milestone.

Ownership is not one mechanism. GTM ownership is stamped into each object's `notes` field. GA4 has
no equivalent metadata field, so it falls back to `.analytics/state.json`. Every new entity type
needs an ownership answer before it can be managed, and they fall into three categories:

| Category | Mechanism | Examples |
|---|---|---|
| Notes-stamped | `notes` field on the object | tags, triggers, variables, folders |
| State-tracked | `.analytics/state.json` | all GA4 resources |
| Toggle-only | no ownership needed, the resource is a boolean rather than a thing we create | GTM built-in variables, enhanced measurement settings |

The notes mechanism has a known limitation: `notes` is editable in the GTM UI, so a human can break
ownership by clearing it. There is no API-level alternative. The mitigation is drift detection
(0.3), not a different mechanism.

Write quota is a real ceiling. The GTM API rate-limits writes per container. Every breadth milestone
that adds entity types also adds `apply` round trips, so batching, backoff, and retry belong inside
those milestones rather than in a separate performance one.

The config is a tracking plan, not just an API wrapper. The `events:` block compiles down to GTM and
GA4 resources today. Everything in 0.6 exists because that block is also the only machine-readable
description of what the product measures, and that has uses beyond `apply`.

## Done (0.2): safe to run unattended

The gate for using this in CI at all. Nothing here was a new feature; all of it closed a way the
tool could be wrong.

- GA4 ownership tracked by committing `.analytics/state.json` instead of gitignoring it, so a CI
  runner starts with a known set of managed resources instead of an empty one
- State format versioning (`readState` rejects a version it doesn't understand) and a lock on
  `apply`'s write phase, so two concurrent `apply` runs can't interleave writes
- `gtm-code publish`, to create a GTM container version from the workspace `apply` wrote to and
  publish it, named after the current git commit
- Workspace conflict detection: `apply` refuses to proceed if the GTM workspace has changes it
  can't safely merge, most likely a human editing it in the UI
- `gtm-code rollback`, to republish the container version that was live before the current one
- `--allow-destroy`, required on top of `--auto-approve` for any `apply` that includes a delete
- `plan --format json` and `plan --format markdown`, and a three-way exit code (`0` no changes,
  `2` changes pending, `1` error) so CI can branch without parsing output

Not yet published to npm; the package is still at `0.1.1`. See README's [Output
contract](./README.md#output-contract) for the stable JSON shape and exit codes this milestone
adds.

### The GitHub Action

The action is released and lives in its own repository,
[StackMade/gtm-as-code-action](https://github.com/StackMade/gtm-as-code-action), consumed as
`uses: StackMade/gtm-as-code-action@v0`. What follows is why it is shaped that way, and what this
repository still owes it.

It is a composite action, because that is the primitive: a reusable `workflow_call` workflow can
call an action, not the reverse, and a composite action drops into a job the caller already has
instead of dictating `runs-on`, `permissions` and job structure. If the job-level form is wanted
later, a `workflow_call` workflow wrapping the action is a thin addition.

It sits in a separate repository for one mechanical reason: git tags. This repository publishes an
npm package, and `npm version` writes tags into the same namespace an action tag would use. A repo
cannot cleanly carry both a `v0` that means "action major 0" and a `v0.2.0` that means "CLI
release". The split also gives the action its own README, which is what a Marketplace listing
renders, instead of the npm-oriented one. It costs a recurring chore, described under release
coordination below, and that chore is the design working rather than failing.

Version pinning is the decision that makes the action's tag mean anything. A consumer's `uses: ...@v0`
checks the action repository out at that tag with no build step and no `node_modules`, so the action
installs the CLI from the npm registry rather than running checked-out source. That creates two
version lines, and only one arrangement is honest: `action.yml` carries a `version` input whose
default is a hard-pinned version string, bumped when the action tag is cut. Running `@latest` from
inside the action would mean the major tag pins nothing, and a single breaking npm release would
break every pinned consumer.

Authentication is the caller's job. Callers run `google-github-actions/auth` or equivalent before
this step, and the action reads credentials from the environment. It must never accept a
service-account key as an action input, because that writes a credential into workflow inputs and,
from there, into logs and forks.

Its inputs are `command` (`validate`, `plan`, or `apply`), `version`, `config`,
`working-directory` (configs live under `analytics/`, and monorepos need it), `node-version`
(default 22), `auto-approve`, and `allow-destroy`. The last two default to false: an apply action
that auto-approves by default is a footgun in precisely the environment it runs in.

Outputs let a caller branch, gate an environment, or post the plan as a PR comment: `has-changes`
plus create, update and delete counts, and the rendered plan. This repository's half of that work is
done: `plan --format json` and `plan --format markdown` (see README's [Output
contract](./README.md#output-contract)) and `plan`'s three-way exit code are documented and treated
as stable, because the action in its own repository parses them. Wiring the action's own
`has-changes`/count/`plan` outputs to that contract is that repository's remaining work, not this
one's.

Releases are cut by tagging `vX.Y.Z` in the action repository and force-moving the `vX` tag onto it,
which is the convention consumers already expect from every other action.

Release coordination is the one recurring chore the split introduces. Every new CLI version on npm
needs a deliberate bump of the pinned default in the action repository, followed by an action
release. It is the thing most likely to silently rot, so it is worth automating early, even if only
as a scheduled check comparing the pinned default against the latest npm version.

## Done (0.3): adopt an existing setup

Until this shipped the tool only served greenfield containers, which is almost none of them.

- `gtm-code pull`. Reverse-generate YAML from a live container and property, in two modes: `pull`
  with no flags imports everything to bootstrap a config, `--resource <kind>:<id>` imports one
  named resource into an existing config. Deliberately read-only, so it can't write the ownership
  metadata `plan`/`apply` need on its own — `gtm-code adopt <kind>:<id>` is the separate write step
  that closes that gap. See [[2026-08-28-gtm-code-pull-and-export-ingest]] and
  [[2026-08-28-gtm-code-adopt]].
- GTM container export ingest, as `pull --from-export <path>`. Reads a GTM UI container export
  (Admin -> Export Container) instead of calling the API — faster, permission-free, GTM only (no
  GA4 equivalent exists).
- Drift detection, as `gtm-code drift`. A read-only check with a non-zero exit when live state has
  diverged from config — the scheduled-CI counterpart to `plan`, and the mitigation (not a fix) for
  ownership notes being editable by hand.
- `gtm-code diff <fileA> <fileB>`. Config-to-config comparison, for reviewing a change without
  network access.

Also shipped alongside 0.3, requested by the first real adopter (PoliczProsto.pl) and blocking its
migration: `googleTag` configuration parameters and firing triggers (task_034, task_035). Not done:
built-in-trigger reserved names (the other half of task_035) — no documented API mechanism to
resolve them and no sandbox available to verify one, see
[[2026-08-28-builtin-trigger-resolution-deferred]].

## 0.4: GTM coverage

Today's coverage is one variable type, one trigger type, two tag types. Most real containers cannot
be expressed at all. Ordered within the milestone by how many containers each unlocks.

- Built-in variables — **done**. The click/page/form/error/history/debug set (`gtm.builtInVariables`
  in config), enable-only through `plan`/`apply`/`drift`, no ownership tracking — see the
  Configuration reference in README. Scroll depth, element visibility, video, and AMP variables are
  not yet covered.
- Trigger types — **done**. Page view, DOM ready, window loaded, click (all elements and links),
  form submission, scroll depth, element visibility, timer, history change, JavaScript error, custom
  event with regex matching, trigger groups. Bare types (`pageview`, `domReady`, `windowLoaded`,
  `click`, `linkClick`, `formSubmission`, `scrollDepth`, `historyChange`, `jsError`) need only their
  GTM `type` string; `elementVisibility`, `timer`, and `triggerGroup` carry fields of their own.
- Trigger exceptions — **done**. `exceptTrigger` on a tag maps to GTM's `blockingTriggerId`,
  alongside the existing `trigger`/`firingTriggerId`. Works for every tag type this tool already
  supports (`ga4Event`, `googleTag`); nothing new to add once a new tag type lands, since both
  fields resolve through the same generic trigger-id helper.
- Variable types — **done**. Constant, custom JavaScript, lookup table, regex table, URL, cookie,
  DOM element, JavaScript variable, auto-event variables, Google tag settings.
- Tag types — **partly done**. Custom HTML and custom image are covered. Conversion linker and
  community-gallery templates are not: conversion linker's live payload (`vendorTemplate.parameter`)
  needs real Floodlight advertiser/group/activity ids that this sandbox container doesn't have, and
  community-gallery templates need a published gallery template's own parameter schema — neither
  could be live-verified, so per this file's own header they weren't guessed at.
- Tag firing behavior — **done**. Priority, once-per-event/page/unlimited, scheduling
  (`scheduleStart`/`scheduleEnd`), and tag sequencing (`setupTags`/`teardownTags`, cross-referenced
  and dependency-ordered like `trigger`/`exceptTrigger`). "Once per ever" isn't a GTM firing option —
  the API only has unlimited/once-per-event/once-per-page (GTM's own "once per page" wording is
  `ONCE_PER_LOAD`).
- Folders — **done**. `gtm.folders` (variables/triggers/tags gain an optional `folder` field
  referencing a name declared there), maps to GTM's `parentFolderId`. Ownership-tracked (`notes`)
  and topologically ordered before the resources that reference it, same as any other kind.
  Covered end to end: schema validation, dependency graph, apply, pull, and export-ingest.
- Built-in trigger references. **Done.** A tag's `trigger`/`exceptTrigger` can reference GTM's
  built-in triggers ("All Pages", "Initialization - All Pages") by name, resolved to their fixed
  numeric ids (`src/providers/google/gtm/builtin-triggers.ts`) rather than looked up in
  `gtm.triggers`, since GTM never returns these from `triggers.list`. This was task_035's other
  half, deferred since 2026-08-28 for lack of a verified resolution mechanism; live-verified
  2026-08-29 (`triggers.get` 404s for both known ids regardless, but a tag created with
  `firingTriggerId` set to either succeeds and reads back correctly). "Consent Initialization - All
  Pages" is a known third built-in trigger whose numeric id couldn't be confirmed through the API
  this way and isn't guessed at.
- Custom templates. Managing template code as files in the repo, which is where sandboxed JavaScript
  belongs anyway. **Blocked, not a skipped-on-purpose gap like conversion linker.** The `templates`
  collection itself works fine (live-verified: `POST .../templates` with a `templateData` string in
  GTM's own `.tpl` export format returns a `templateId`), but attaching a tag to a template failed
  every combination tried: `type` set to the template's declared `___INFO___.id`, to
  `cvt_<accountId>_<containerId>_<templateId>`, and a `vendorTemplate.key.publicId` field, all
  rejected with `vendorTemplate.key: Unknown entity type`. The real linkage GTM's UI produces isn't
  reproducible from a `.tpl` file's declared fields alone; needs either a real UI-exported example
  tag payload to compare against, or GTM support docs this session didn't have access to.

## 0.5: Consent Mode v2 and governance

The highest-value config-shaped feature that isn't coverage. Consent settings are legally required
in the EEA, tedious and error-prone to set per tag in the UI, and reviewed by people who would
rather read a diff than click through 40 tags.

- A `consent:` block. **Done, via existing primitives, not new syntax.** A bare `consentInit`
  trigger (live-verified: `{name, type: 'consentInit'}`, no configurable fields) fires before
  everything else, and a per-tag/per-event `consent: {status, types}` field maps to GTM's
  `consentSettings` (live-verified shape: `{consentStatus: 'needed', consentType: {type: 'list',
  list: [{type: 'template', value: '<type>'}]}}` when `needed`, `{consentStatus: 'notNeeded'}`
  otherwise; `types` isn't accepted when `notNeeded`). A config author writes an ordinary
  `consentInit` trigger plus a `customHtml` tag that calls `gtag('consent', 'default', ...)`; no
  dedicated "consent initialization tag" object exists in the GTM API to compile to.
- Consent lint. **Done.** `gtm.tags` entries of type `ga4Event`/`googleTag`, and every `events.*`
  entry (which compiles to a `ga4Event` tag), fail validation without a `consent` block. Other tag
  types aren't checked: there's no reliable way to tell from `type` alone whether a `customHtml` or
  `customImage` tag loads something that needs consent.
- PII lint. **Done.** Event parameter names are checked against a list of substrings that suggest
  personal data (`email`, `phone`, `address`, `ssn`, `password`, and more; see `PII_NAME_PATTERNS`
  in `src/config/schema.ts`). A substring list is a heuristic, not a guarantee: it won't catch every
  PII-shaped name, and it can flag a legitimate name that happens to contain one of the patterns.
- Protected resources. **Done.** `protected: true` on a `gtm.variables`/`triggers`/`tags` entry is
  stamped into GTM's `notes` field alongside ownership metadata, so it survives even after the
  resource is removed from config. `ga4.dimensions`/`metrics`/`keyEvents` have no equivalent field,
  so their flag lives in `.analytics/state.json`'s `protectedResources` list instead. Either way,
  deleting a protected resource needs `--allow-destroy-protected` in addition to `--allow-destroy`.

## 0.6: the tracking plan as a product

Everything here reads the config and produces something other than an API call. Cheap to build
relative to its value, because the data is already there.

- GA4 limits and naming linter, inside `validate`. Done. Reserved event names and prefixes,
  reserved parameter names and prefixes (`ga_*`, `firebase_*`, `google_*`, `gtag.*`), the
  letters/digits/underscore-starting-with-a-letter name pattern, the 40-character name cap, the
  per-event 25-parameter cap, and (checked in `compile.ts` once `events.*` has expanded, since
  hand-written and event-derived dimensions share one budget) the 50-event-scoped-custom-dimension
  cap per property. All limits verified against Google's current published docs, not recalled from
  training data. `snake_case` naming was deliberately left unenforced: it's a convention, not an
  API-enforced limit, and a hard-fail linter would break real configs and CI on a minor version
  bump. All offline, zero API cost, and it catches at review time what would otherwise fail
  mid-`apply` or get silently rejected/scrubbed by GA4.
- `gtm-code docs`. Done. Generates a Markdown data dictionary from `events:`: one section per event
  with description, key-event/consent flags, and a parameter table. Stdout by default, `--out` to
  write a file. HTML output dropped from the original scope: Markdown renders fine on GitHub/GitLab
  and in most wikis, and a second output format is easy to add later if someone needs it. Every
  analytics team maintains this by hand in a spreadsheet that is wrong within a month.
- `gtm-code generate`. Done. Emits an `EventName` union, one params interface per event, an
  `EventParams` map, and a `track<E extends EventName>(event, params)` function that pushes
  `{ event, ...params }` onto `window.dataLayer`. Stdout by default, `--out` to write a file. So a
  typo in an event name, or a missing required parameter, is a compile error rather than missing
  data in GA4.
- Config composition. Done. `extends: <path|array>` at the config root, resolved in `loadConfig`
  before validation runs, so every command gets it without per-command changes. Merges
  `events:`/`gtm.{variables,triggers,tags,folders}:`/`ga4.{dimensions,metrics,keyEvents}:` from the
  target files; root wins over an extends target, and two extends targets colliding on the same
  entry is a validation error rather than silent last-wins. An extends target can't set identity or
  credential fields (`version`, `project`, `google.*`, `gtm.builtInVariables`), so a shared pack
  never carries another repo's account IDs. `ParsedConfig` gained an `origins` map from entry to the
  file it was actually defined in, so a validation error on merged-in content still points at the
  right file and line instead of the root config's.
- Event packs. Done. `packs/ecommerce.yaml` and `packs/recommended.yaml`, `extends:`-able GA4
  recommended events with their GA4-specified parameters. Added `type: items` to `EventParameterDef`
  for GA4's ecommerce item array (`generate` emits a shared `Item` interface), and narrowed the
  reserved-parameter-name check so `currency` is only blocked when marked `dimension: true`, since
  it's reserved for custom dimension/metric creation, not for GA4's own recommended events that
  require it as a standard parameter. See [[2026-08-29-event-packs]].

## 0.7: GA4 coverage

The Admin API surface well beyond custom dimensions. Each item is state-tracked ownership, so 0.2's
GA4 hardening is a hard prerequisite for all of it.

- Data streams and enhanced measurement. **Partially done.** `ga4.streamWebsiteUrl` looks up an
  existing web stream by URL (this tool never creates or deletes streams), and
  `ga4.enhancedMeasurement.{scrollsEnabled, outboundClicksEnabled, siteSearchEnabled,
  videoEngagementEnabled, fileDownloadsEnabled, formInteractionsEnabled}` diffs against the stream's
  live `enhancedMeasurementSettings` and applies via `plan`/`apply`, following the settings-diff
  model below rather than the create/update/delete `Resource` model, since a stream's enhanced
  measurement flags have no lifecycle of their own. Still open: iOS/Android streams, and measurement
  protocol secrets. Creating streams and deriving `google.ga4.measurementId` from one, so it no
  longer needs pasting into both config and the GTM Google tag by hand, is also still open.
- Property settings. **Partially done.** `ga4.dataRetention` and `ga4.googleSignals` diff against
  the property's live `dataRetentionSettings`/`googleSignalsSettings` and apply via `plan`/`apply`.
  Both are property-level settings with no create/delete lifecycle, so they're diffed directly
  against GA4's live state (`src/providers/google/ga4/settings.ts`) rather than modeled as
  `Resource`s; `googleSignalsSettings` and a stream's `enhancedMeasurementSettings` live under the
  GA4 Admin API's `v1alpha`, not `v1beta` like everything else this tool touches (confirmed live
  2026-08-29: both 404 on `v1beta`), so `Ga4Client` routes each request to the version it actually
  lives under. Still open: internal and developer traffic filters, attribution settings.
- Audiences. **Done.** `ga4.audiences` models audiences as create/update/archive `Resource`s (GA4's
  API has no `delete`, only `archive`). `membershipDurationDays`, `exclusionDurationMode`, and
  `filterClauses` are immutable once created; `plan` fails loudly, naming the field, rather than
  silently no-op-ing or letting GA4's own error surface unexplained. The filter expression tree
  (`and`/`or`/`not`/`dimensionOrMetric`/`event`, recursive; `sequenceFilter` not implemented) is
  normalized at validation time into the shape GA4 actually requires: confirmed live 2026-08-29 that
  the top-level expression must be an `andGroup` whose direct children are each an `orGroup`, so a
  config author can write a single bare condition and never see that requirement. Also confirmed
  live: `sessionCount`/`eventCount` aren't valid audience filter fields even though they're valid
  GA4 dimensions/metrics elsewhere, and an archived audience drops out of `list()` entirely, so no
  extra archived-filtering logic was needed beyond the existing `archivable` handling.
- Event create and modify rules. Server-side event rewriting, currently invisible to anyone reading
  the site's code.
- Calculated metrics and channel groups.
- Search Console link. Google Ads and BigQuery links are deliberately excluded, and not planned for
  any later milestone either.

## 0.8: verify against reality

Everything before this verifies that the configuration is what was declared. This verifies that the
data is. Moved ahead of environments/scale: it is a correctness gate, the same category as 0.2/0.3,
not breadth, and this roadmap orders correctness gates before breadth on principle. Nothing in it
depends on multi-environment or multi-container support existing first.

- `gtm-code verify`. Query the GA4 Data API for the declared events over the last N days and report
  which ones have never been received, or are missing declared parameters. It needs a different API
  and scope than the Admin API work above, hence its own milestone. This is the check the GTM UI
  cannot give you: config can be perfect while the site never fires the event.
- `gtm-code doctor`. Check credentials, API enablement, granted scopes, and quota headroom, and
  explain what's missing instead of failing mid-run.

## 0.9: environments and scale

Moved after verification on purpose: multi-environment, multi-container, and access-as-code are real
but currently speculative scope, no adopter has asked for a second container or property yet. Revisit
the ordering if that changes before 0.8 ships.

- An `environments:` block and `--env`. Dev, staging and production against different containers and
  properties from one config.
- GTM environments. The API's own environment resources, distinct from the config-level concept
  above.
- Multiple containers and properties per config. Currently one of each is assumed throughout.
- Access as code. GTM user permissions and GA4 access bindings. Useful, and also the point at which
  a mistake in this tool becomes a security incident, hence last, and behind `--allow-destroy`-style
  guards.

## 1.0

Stability, not features.

- Config schema versioning and `gtm-code migrate` between versions.
- Rename support: a way to say "this id used to be called that" so a rename is an update rather than
  a destroy-and-create.
- In the companion `gtm-as-code-action` repository, a GitHub Marketplace listing and a
  `workflow_call` reusable workflow wrapping the action for callers who want the job-level form.
- Documented API stability guarantees for the config schema and, if one is exposed by then, the
  programmatic entry point.

## After 1.0

- A runtime validation package. A small browser package that validates `dataLayer` pushes against
  the tracking plan during development, so a malformed event fails locally rather than silently
  producing bad data for a quarter. Separate npm package, separate release cycle: this is a second
  product surface, not a CLI flag.
- Providers beyond Google. The `src/providers/` layout anticipates it. Nothing is planned.

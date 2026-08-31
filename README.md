# gtm-as-code

Google Tag Manager and GA4 configuration, managed as code. Declare your events, GTM resources, and
GA4 resources in a YAML file, review the diff with `plan`, and apply it, Terraform-style.

- Version-control your analytics setup and review changes in pull requests.
- Preview what would change before it happens.
- Deploy through CI/CD instead of clicking through the GTM UI.

## Status

Early (`0.1.0`). `init`, `validate`, `plan`, and `apply` work and are verified against a real GTM
container and GA4 property. See [ROADMAP.md](./ROADMAP.md) and the
[Roadmap section below](#roadmap--not-yet-implemented) for what isn't built yet. Check there before
assuming a feature exists.

## Install

```bash
npm install -D @stackmade/gtm-as-code
```

Requires Node.js >= 22.

## Quickstart

Scaffold a config in the current project:

```bash
npx gtm-code init
```

You'll be prompted for your GTM account ID, GTM container ID, and GA4 property ID. This creates:

```
analytics/analytics.yaml
analytics/README.md
analytics/.env.analytics.example
```

`analytics/analytics.yaml` starts out empty, ready for you to fill in:

```yaml
version: 1

project:
  name: change-me

google:
  gtm:
    accountId: "${GTM_ACCOUNT_ID}"
    containerId: "${GTM_CONTAINER_ID}"

  ga4:
    propertyId: "${GA4_PROPERTY_ID}"

events: {}

gtm:
  variables: {}
  triggers: {}
  tags: {}

ga4:
  dimensions: {}
  metrics: {}
  keyEvents: {}
```

`analytics/.env.analytics.example` holds the IDs you gave `init`. Copy it to
`analytics/.env.analytics` (gitignored, see [State](#state)) with your real values, or set the same
variables in your CI environment.

Check the config offline, no Google credentials required:

```bash
gtm-code validate
```

```
✓ analytics/analytics.yaml parsed
✓ 0 events
✓ 0 custom dimensions
✓ 0 key events
✓ configuration valid
```

Once you're authenticated (see [Prerequisites](#prerequisites)), preview what would change in your
live GTM container and GA4 property:

```bash
gtm-code plan
```

```
GTM as Code

Google Tag Manager

+ create variable   form
~ update trigger    generate_lead
    triggerCondition: {...} → {...}
- delete tag         GA4 - old_tag

Google Analytics 4

+ dimension          form

Plan:
  2 to create
  1 to update
  1 to delete
```

And apply it:

```bash
gtm-code apply
```

`apply` runs the same diff as `plan`, prints a `⚠ DELETE` warning for every resource it's about to
remove, then asks for confirmation before doing anything. Pass `--auto-approve` to skip the prompt
in CI.

## Prerequisites

You need Node.js 22 or newer, and an existing GTM container and GA4 property. This tool manages
resources inside them; it does not create the container or the property itself.

Google credentials are resolved through the standard Application Default Credentials chain. Locally
that means `gcloud auth application-default login`. In CI, either point
`GOOGLE_APPLICATION_CREDENTIALS` at a service-account key file or configure Workload Identity
Federation.

You don't need to pick scopes yourself. `plan` requests read-only scopes (`tagmanager.readonly`,
`analytics.readonly`) and `apply` requests edit scopes (`tagmanager.edit.containers`,
`analytics.edit`).

## Configuration reference

The config file is looked up as `analytics.yaml` or `analytics/analytics.yaml` in the current
directory, or you can point at a specific file with `-c, --config <path>`.

### Environment variable interpolation

Any string value can reference an environment variable:

```yaml
accountId: "${GTM_ACCOUNT_ID}"
propertyId: "${GA4_PROPERTY_ID:-123456789}"   # with a default
```

A reference with no default that resolves to an unset variable fails validation. Keep real
account, container, and property IDs, and any secrets, out of the YAML. Put them in environment
variables instead, as `init`'s scaffold does.

### Config composition (`extends:`)

A config can pull in `events:`/`gtm.{variables,triggers,tags,folders}:`/`ga4.{dimensions,metrics,keyEvents}:`
entries from other YAML files, for shared conventions or reusable packs:

```yaml
extends: ./packs/ecommerce.yaml
# or: extends: [./packs/ecommerce.yaml, ./packs/consent.yaml]
```

Paths resolve relative to the file that contains the `extends:` key, and an extends target can
itself extend further files. The root config always wins: an entry it defines directly can't be
overridden by an extends target, and two extends targets can't define the same entry either, both
fail validation rather than picking one silently. An extends target may only contain the sections
listed above, nothing that identifies or authenticates a specific GTM/GA4 property (`version`,
`project`, `google.*`, `gtm.builtInVariables`), so a shared pack never carries another repo's
account IDs by accident. Validation errors on an entry pulled in this way point at the file and
line it actually came from, not the root config.

#### Event packs

`packs/ecommerce.yaml` and `packs/recommended.yaml`, shipped in this repo, are `extends:` targets
for GA4's recommended events. `packs/ecommerce.yaml` covers `view_item`, `add_to_cart`,
`begin_checkout`, `purchase`, and the rest of the ecommerce set, each with its GA4-specified
parameters, including the `items` array. `packs/recommended.yaml` covers `login`, `sign_up`,
`search`, and `share`. Both default consent to `{ status: needed, types: [analytics_storage] }`;
override an event in your own config to change that, root always wins.

```yaml
extends: ./node_modules/@stackmade/gtm-as-code/packs/ecommerce.yaml
```

### Schema

```yaml
version: 1                     # only 1 is accepted

project:
  name: string

google:
  gtm:
    accountId: string
    containerId: string
    workspace: string          # optional, workspace id or display name (e.g. "Default Workspace")

  ga4:
    propertyId: string
    measurementId: string      # optional, derived from ga4.streamWebsiteUrl's web stream if unset

events:
  <event_name>:
    description: string        # optional
    keyEvent: boolean          # optional
    parameters:
      <param_name>:
        type: string | number | boolean | items   # items is GA4's ecommerce item array
        dimension: boolean     # optional, also registers this parameter as a GA4 dimension
                                # (not allowed on a type: items parameter, GA4 dimensions are scalar)
        optional: boolean      # optional
    consent:                   # required: every event compiles to a ga4Event tag, which needs one
      status: needed | notNeeded
      types: [string, ...]     # required when status is needed, e.g. [analytics_storage]

gtm:
  builtInVariables: [string, ...]  # optional, GTM display names e.g. "Click Text", "Page Path"
  folders:
    <name>: {}
  variables:
    <name>: { type: string, folder: string, protected: boolean, ... }
  triggers:
    <name>: { type: string, folder: string, protected: boolean, ... }
      # a bare "consentInit" trigger (no extra fields) fires before every other trigger
  tags:
    <name>: { type: string, trigger: [string, ...], exceptTrigger: [string, ...],
               setupTags: [string, ...], teardownTags: [string, ...], folder: string,
               protected: boolean, consent: { status: needed | notNeeded, types: [string, ...] }, ... }
      # trigger and exceptTrigger (optional, blocking triggers) reference trigger names above, or
      #   a reserved built-in trigger name ("All Pages", "Initialization - All Pages")
      # setupTags/teardownTags (optional) reference other tag names, mapping to GTM's
      #   setupTag/teardownTag tag sequencing
      # folder (optional, on variables/triggers/tags too) references a name under gtm.folders
      # protected (optional, on any gtm.* resource) requires --allow-destroy-protected, on top of
      #   --allow-destroy, before apply may delete it
      # consent (required on ga4Event/googleTag tags) maps to GTM's consentSettings; types is only
      #   allowed when status is needed

ga4:
  dimensions:
    <name>: { scope: event | user, parameter: string, protected: boolean }
  metrics:
    <name>: { scope: event | user, parameter: string, measurementUnit: string, protected: boolean }
      # measurementUnit optional
  keyEvents:
    <name>: { protected: boolean }
  streamWebsiteUrl: string
    # the web data stream these stream-scoped settings apply to, looked up by URL, never created
  dataRetention: TWO_MONTHS | FOURTEEN_MONTHS | TWENTY_SIX_MONTHS | THIRTY_EIGHT_MONTHS | FIFTY_MONTHS
    # manages event data retention only, userDataRetention is untouched
    # THIRTY_EIGHT_MONTHS and FIFTY_MONTHS are only valid on GA4 360 properties
  googleSignals: GOOGLE_SIGNALS_ENABLED | GOOGLE_SIGNALS_DISABLED
    # Google Signals must already be activated on the property through the GA4 UI once;
    # this tool can only change its state after that, not activate it
  attributionSettings:
    reportingAttributionModel: string  # e.g. PAID_AND_ORGANIC_CHANNELS_DATA_DRIVEN
    acquisitionConversionEventLookbackWindow: string  # e.g. ACQUISITION_CONVERSION_EVENT_LOOKBACK_WINDOW_30_DAYS
    otherConversionEventLookbackWindow: string  # e.g. OTHER_CONVERSION_EVENT_LOOKBACK_WINDOW_90_DAYS
    # all three optional; only the fields present in config are diffed and updated
  enhancedMeasurement:
    scrollsEnabled: boolean
    outboundClicksEnabled: boolean
    siteSearchEnabled: boolean
    videoEngagementEnabled: boolean
    fileDownloadsEnabled: boolean
    formInteractionsEnabled: boolean
    # requires streamWebsiteUrl to be set
  audiences:
    <name>:
      description: string
      membershipDurationDays: number
      exclusionDurationMode: EXCLUDE_TEMPORARILY | EXCLUDE_PERMANENTLY  # optional
      eventTrigger: { eventName: string, logCondition: AUDIENCE_JOINED | AUDIENCE_MEMBERSHIP_RENEWED }  # optional
      protected: boolean  # optional
      filterClauses:
        - clauseType: INCLUDE | EXCLUDE
          scope: AUDIENCE_FILTER_SCOPE_WITHIN_SAME_SESSION | AUDIENCE_FILTER_SCOPE_WITHIN_SAME_EVENT
            | AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS
          filter:
            # exactly one of the following, and/or/not may nest recursively:
            and: [<filter>, ...]
            or: [<filter>, ...]
            not: <filter>
            dimensionOrMetric: { fieldName: string, atAnyPointInTime: boolean,
              string: { matchType: string, value: string, caseSensitive: boolean } |
              inList: { values: [string], caseSensitive: boolean } |
              numeric: { operation: EQUAL | LESS_THAN | GREATER_THAN, value: number } |
              between: { from: number, to: number } }
            event: { eventName: string, eventParameterFilterExpression: <filter> }  # eventParameterFilterExpression optional
  eventCreateRules:
    <name>:  # <name> is the rule's destinationEvent
      eventConditions:
        - { field: string, comparisonType: string, value: string, negated: boolean }  # 1-10, negated optional
      sourceCopyParameters: boolean  # optional
      parameterMutations:  # optional, up to 20
        - { parameter: string, parameterValue: string }
    # requires streamWebsiteUrl to be set
  eventEditRules:
    <name>:  # <name> is the rule's displayName
      eventConditions:
        - { field: string, comparisonType: string, value: string, negated: boolean }  # 1-10, negated optional
      parameterMutations:  # required, 1-20
        - { parameter: string, parameterValue: string }
    # requires streamWebsiteUrl to be set
  calculatedMetrics:
    <name>:  # <name> is the metric's calculatedMetricId (immutable once created)
      displayName: string
      metricUnit: STANDARD | CURRENCY | FEET | MILES | METERS | KILOMETERS | MILLISECONDS | SECONDS | MINUTES | HOURS
      formula: string  # e.g. "(eventCount / 2.0)"
      description: string  # optional
  channelGroups:
    <name>:  # <name> is the group's displayName
      description: string  # optional
      primary: boolean  # optional, only one channel group can be primary
      groupingRule:  # 1-50
        - displayName: string
          expression:
            # exactly one of the following, and/or/not may nest recursively:
            and: [<filter>, ...]
            or: [<filter>, ...]
            not: <filter>
            filter: { fieldName: string, string: { matchType: string, value: string } |
              inList: { values: [string] } }
  measurementProtocolSecrets:
    <name>: {}  # <name> is the secret's displayName; secretValue is server-generated, never in config
    # requires streamWebsiteUrl to be set; requires the property's User Data Collection
    # Acknowledgement to already be attested through the GA4 UI (Admin -> Data Settings -> Data
    # Collection). This tool can only create the secret after that, not attest it.
```

Only `type` (and, for tags, `trigger`/`exceptTrigger`/`setupTags`/`teardownTags`) is
schema-validated on `gtm.variables`, `gtm.triggers` and `gtm.tags` entries today. Per-resource-type
property shapes aren't validated yet.

`gtm.builtInVariables` is enable-only: `plan`/`drift` report a name listed but not yet enabled
remotely, `apply` enables it. Names not in the config are left alone — enabling one by hand in the
GTM UI is never reported as drift, and `apply` never disables one. Only the click/page/form/error/
history/debug set is supported today (see `src/providers/google/gtm/builtin-variables.ts` for the
exact list); scroll depth, element visibility, video, and AMP variables aren't yet.

A tag's `trigger`/`exceptTrigger` can reference GTM's built-in triggers by name (`"All Pages"`,
`"Initialization - All Pages"`) without declaring them under `gtm.triggers`. These trigger objects
always exist in every container but are never returned by GTM's own `triggers.list`/`triggers.get`,
so a lookup against `gtm.triggers` can't resolve them, this tool maps the reserved name straight to
GTM's fixed numeric trigger id instead (see `src/providers/google/gtm/builtin-triggers.ts`). Only the
two names above are supported; `"Consent Initialization - All Pages"` is a known GTM UI trigger whose
numeric id couldn't be confirmed through the API and isn't guessed at.

`ga4.dataRetention`, `ga4.googleSignals`, `ga4.attributionSettings` and `ga4.enhancedMeasurement`
have no create/delete lifecycle, unlike dimensions/metrics/keyEvents. `plan`/`drift` compare the
declared value against GA4's live property/stream state and report a difference as an update;
`apply` PATCHes it. A setting left out of config is never touched, so enabling one by hand in the
GA4 UI is never reported as drift. `dataRetention`, `googleSignals` and `attributionSettings` are
property-level and apply regardless of `streamWebsiteUrl`; `enhancedMeasurement` is scoped to the
stream `streamWebsiteUrl` resolves to, so it requires that field. `googleSignals`,
`attributionSettings` and `enhancedMeasurement` live under the GA4 Admin API's `v1alpha`, not
`v1beta` like everything else this tool touches, since GA4 hasn't promoted them to `v1beta` yet;
this tool routes each request to the right version internally. `attributionSettings` accepts only
`reportingAttributionModel`, `acquisitionConversionEventLookbackWindow` and
`otherConversionEventLookbackWindow`; `adsWebConversionDataExportScope` is left out since it's an
Ads-linking concept GA4's own Attribution settings UI doesn't expose there either, and it rejected
being set back to its own current value when tried live.

Internal traffic and developer traffic filters have no public GA4 Admin API resource at all
(confirmed live: every plausible collection name under both `v1beta` and `v1alpha` 404s), so they
stay GA4-UI-only, alongside iOS/Android data streams.

`ga4.audiences` are create/update/archive `Resource`s like dimensions and key events, not
settings-diffed like the property/stream fields above, since GA4's Admin API has no audience `delete`,
only `archive`, and an archived audience drops out of `list()`. `membershipDurationDays`,
`exclusionDurationMode`, and `filterClauses` cannot be changed on an existing audience through the
API; `plan` fails with an error naming the field rather than attempting a PATCH GA4 would reject.
Only `description` (mapped from the config key's `<name>`, i.e. `displayName`) can be updated in
place. A `filter`'s `and`/`or`/`not`/`dimensionOrMetric`/`event` nesting is validated to have
exactly one of those keys set at each level; GA4 also requires every clause's top-level filter to
be an `and` of `or`s, which validation adds automatically, so a single bare condition
(`filter: { event: { eventName: ... } } }`) is enough and never needs writing out by hand.
`sequenceFilter` isn't implemented.

`ga4.eventCreateRules` and `ga4.eventEditRules` are also create/update/delete `Resource`s, but
nested under a data stream rather than the property (confirmed live 2026-08-29: both 404 on
`v1beta`), so both require `streamWebsiteUrl`. Unlike audiences, GA4 supports a real `DELETE` for
both, no archive step. A create rule's config key is its `destinationEvent` (it has no separate
label field, the same non-uniqueness caveat `ga4.keyEvents`' `eventName` already carries); an edit
rule's config key is its `displayName`. `comparisonType` accepts GA4's standard set
(`EQUALS`/`CONTAINS`/`STARTS_WITH`/`ENDS_WITH`/`GREATER_THAN`/`LESS_THAN`, their
`_CASE_INSENSITIVE`/`_OR_EQUAL` variants, and `REGULAR_EXPRESSION*`, web-stream only, not enforced
here). Edit rules also carry a GA4-assigned `processingOrder` (their evaluation order relative to
other edit rules on the same stream) that's read-only through this API (confirmed live that GA4
rejects it in any `updateMask`), so it's never part of config and never round-tripped back from a
`pull`; reordering rules isn't supported. `pull` only fetches these two kinds when the property has
exactly one web data stream to resolve to; with more than one, it skips them and prints why.

`ga4.calculatedMetrics` and `ga4.channelGroups` are property-scoped create/update/delete
`Resource`s (v1alpha, confirmed live 2026-08-29: both 404 on `v1beta`), unaffected by
`streamWebsiteUrl`. A calculated metric's config key is its `calculatedMetricId`, GA4's immutable
identifier (externally referenced as `calcMetric:{id}`); unlike every other kind's identity field,
GA4 requires it as a create-time query parameter rather than a body field, since the body field
itself is output-only. `metricUnit` is mutable after creation (confirmed live, despite there being
no field-level note in GA4's own docs saying so); `formula`, `description`, and `displayName`
(a separate, mutable label, distinct from the config key) are too. A channel group's config key is
its `displayName`, like `ga4.audiences`. `groupingRule[].expression` follows the same
`and`-of-`or`s top-level nesting GA4 requires of an audience filter, so a single bare `filter`
condition is enough and gets normalized automatically. Its leaf `filter` has no `dimensionOrMetric`/
`event` wrapper, just `fieldName` plus a `string` or `inList` match, and neither supports
`caseSensitive` (confirmed live GA4 rejects the field outright, unlike an audience's dimensionOrMetric
filter). Valid `fieldName` values use an undocumented `eachScope`-prefixed convention (e.g.
`eachScopeSource`, `eachScopeMedium`, `eachScopeCampaignId`) discovered by reading GA4's own
pre-existing "Default channel group"; this tool doesn't validate `fieldName` against that set; a
wrong value surfaces as GA4's own error on apply. Both kinds support a real `DELETE`, no archive
step; deleting the property's system-defined "Default channel group" isn't possible through the API
regardless.

`google.ga4.measurementId` no longer has to be set by hand. When it's absent, `plan`/`apply`/`drift`
derive it from `ga4.streamWebsiteUrl`'s resolved web stream (its `webStreamData.measurementId`), the
same lookup `enhancedMeasurement`/event create-edit rules already do. An explicit
`google.ga4.measurementId` still wins if both are present. `gtm-code diff` and other offline commands
(`validate`, `docs`, `generate`) never derive it, since they have no network access, so a `ga4Event`/
`googleTag` tag compiled there has no `measurementId` unless one is set explicitly in config.

`ga4.measurementProtocolSecrets` are stream-scoped create/update/delete `Resource`s (`v1beta`,
confirmed live 2026-08-30, unlike event create/edit rules which are `v1alpha`), so require
`streamWebsiteUrl` like they do. A secret's config key is its `displayName`; `secretValue` is
server-generated and output-only, so it's never read from or written to config, and this tool never
logs it. Creating one has a real precondition this tool can't satisfy through the API: the property's
User Data Collection Acknowledgement must first be attested through the GA4 UI (Admin -> Data
Settings -> Data Collection), confirmed live. `apply` surfaces GA4's `FAILED_PRECONDITION` with that
remediation hint rather than a bare status code.

GA4's Admin API refuses to create `ANDROID_APP_DATA_STREAM`/`IOS_APP_DATA_STREAM` data streams
outright (confirmed live 2026-08-30: `INVALID_ARGUMENT`, "To create app streams, use the Firebase
API"). This is a hard API boundary, not a gap in this tool, so `ga4.dataStreams` as a managed
resource isn't implemented. Existing app streams (created through Firebase) aren't read by `pull`
either; only web streams are touched, via `streamWebsiteUrl`.

Validation also catches:
- unknown top-level or nested keys (with a "did you mean" suggestion),
- the same resource id defined twice across `gtm.*` and `ga4.*`,
- a tag's `trigger` or `exceptTrigger` referencing a trigger name that doesn't exist,
- a tag's `setupTags` or `teardownTags` referencing a tag name that doesn't exist, or itself,
- a `folder` referencing a name not defined under `gtm.folders`,
- a `ga4Event` or `googleTag` tag (hand-authored, or compiled from `events.*`) with no `consent`
  block, since it would otherwise load a Google measurement script with no consent check,
- an event parameter whose name suggests personal data (`email`, `phone`, `address`, and similar).
  GA4 responds to PII in event parameters by deleting the data, not just rejecting the request.
- GA4 naming and limit violations: an event or parameter name that doesn't start with a letter or
  contains characters other than letters/digits/underscores, a name over 40 characters, a reserved
  event name (`page_view`, `click`, `first_visit`, and the rest of GA4's automatically-collected
  set), a reserved parameter name or prefix (`user_id`, `ga_*`, `firebase_*`, `google_*`, `gtag.*`),
  an event with more than 25 parameters, or (checked after `events.*` compiles, since hand-written
  and event-derived dimensions share one cap) more than 50 event-scoped custom dimensions.
  `currency` is only reserved when marked `dimension: true`, GA4's own recommended ecommerce events
  send it as a plain parameter.

## CLI reference

Global flags, available on every command:

| Flag | Description |
|---|---|
| `-c, --config <path>` | Path to the config file (default: auto-discovered) |
| `-v, --verbose` | Verbose output |
| `-q, --quiet` | Suppress non-error output |
| `-f, --format <type>` | `text`, `json`, or `markdown`. `plan` supports all three; other commands ignore it and print `text` |

### `gtm-code init`

Interactively scaffolds `analytics/analytics.yaml`, `analytics/README.md`, and
`analytics/.env.analytics.example`. If `analytics/analytics.yaml` already exists, asks before
overwriting.

### `gtm-code validate`

Parses and schema-checks the config offline. No Google API calls, no credentials needed.

### `gtm-code plan [--format text|json|markdown]`

Authorizes with read-only scopes, diffs your config against the live GTM container and GA4
property, and prints the result. Never creates, updates, or deletes anything.

See [Output contract](#output-contract) below for `--format json`, `--format markdown`, and exit
codes.

### `gtm-code diff <fileA> <fileB> [--format text|json|markdown]`

Compares two config files against each other (`fileA` as the baseline, `fileB` as desired), the
same way `plan` compares a config against live state. No network calls, no credentials needed. Exit
code `2` if the two files differ, `1` on a load/validation error, `0` if they resolve to the same
resources.

### `gtm-code drift [--format json|markdown]`

The read-only, CI-friendly sibling of `plan`. Authorizes with the same read-only scopes, compares
live state against config, and reports whether they've diverged, without printing the full plan
detail `plan` does. Exit code `1` if drift is found (or on error), `0` if clean.

### `gtm-code apply [--auto-approve] [--allow-destroy] [--allow-destroy-protected]`

Runs the same diff as `plan`, then executes it. Deletes go first (tags, then triggers, then
variables, the reverse of creation order), then creates in dependency order so a tag can reference
a trigger created in the same run, then updates. Prompts `Continue? [y/N]` unless `--auto-approve`
is passed.

`apply` only writes to the GTM workspace. Nothing reaches the live container until you run
`gtm-code publish`. Before writing anything, `apply` also checks whether the workspace has changes
it can't safely merge, most likely from someone editing the same workspace in the GTM UI, and
refuses to proceed if it finds any rather than overwriting them.

If the plan includes any deletes, `apply` refuses to run unless `--allow-destroy` is also passed,
even with `--auto-approve`. The two flags are independent on purpose: `--auto-approve` is the flag
your routine CI apply already uses, and a destructive change deserves its own opt-in rather than
riding along with it. This applies to GA4 deletes too, even though a GA4 custom dimension or metric
is archived rather than hard-deleted (key events are hard-deleted); `plan` prints all three as
`- delete`, so `apply` treats them the same way for this gate.

A resource marked `protected: true` in config needs `--allow-destroy-protected` on top of
`--allow-destroy` before `apply` deletes it, even if `--allow-destroy` alone would otherwise cover
the rest of the plan. GTM resources carry the flag in their own `notes` field, alongside the
existing ownership metadata; GA4 has no such field, so its flag lives in `.analytics/state.json`
instead (see [State](#state)).

### `gtm-code publish`

Creates a GTM container version from the current workspace and publishes it. The version name and
notes are taken from the current commit (short SHA and subject line) when run inside a git
checkout, so the GTM version history stays readable against your commit history. Requires the
`tagmanager.publish` and `tagmanager.edit.containerversions` scopes (the latter is what
`workspaces:create_version` actually checks — `tagmanager.publish` alone 403s on it).

### `gtm-code rollback [--auto-approve]`

Republishes the container version that was live immediately before the current one. Prints both
versions and prompts `Continue? [y/N]` unless `--auto-approve` is passed. Does nothing to the
workspace or to `.analytics/state.json`; it only changes which already-existing version is live, so
it's close to free to run once `publish` has created a version history to roll back through.
Requires the same scopes as `publish`.

### `gtm-code pull [--resource <kindAndId>] [--out <path>] [--from-export <path>]`

Reverse-generates YAML from a live GTM container and GA4 property. It's the starting point for
putting an existing setup under this tool's management. Three modes, mutually exclusive: no flags pulls
everything into the resolved config; `--resource tag:generate_lead_tag` pulls one resource into the
existing config; `--from-export path.json` ingests a GTM UI container export (Admin > Export
Container) instead of calling the API, so it needs no GTM permissions at all. `--out` overrides
where the config is written (default: the resolved config path). Logical ids are derived by
slugifying each object's GTM name, with `_2`/`_3` suffixes on collisions. Asks before overwriting an
existing output file, except when pulling a single `--resource`, which merges in place. Requires the
same read-only scopes as `plan`, unless you're using `--from-export`.

### `gtm-code docs [--out <path>]`

Generates a data dictionary (Markdown) from `events:`: one section per event with its description,
key-event and consent flags, and a parameter table (type, required, custom dimension). Prints to
stdout by default; `--out` writes it to a file instead. Runs the same validate/compile pipeline as
`validate`, so a config that fails to validate fails `docs` too.

### `gtm-code generate [--out <path>]`

Generates typed event helpers from `events:`: a TypeScript `EventName` union, one params interface
per event, an `EventParams` map, and a `track<E extends EventName>(event: E, params: EventParams[E])`
function that pushes `{ event, ...params }` onto `window.dataLayer`. A typo in an event name or a
missing required parameter is a compile error in the consuming app rather than missing data in GA4.
A `type: items` parameter emits as `Item[]`, backed by a shared `Item` interface (GA4's ecommerce
item fields) that's only emitted when at least one event uses it. Prints to stdout by default;
`--out` writes it to a file. Runs the same validate/compile pipeline as `validate`.

### `gtm-code adopt <kindAndId>`

Stamps ownership on a resource `pull` already brought into the config, so `plan`/`apply` start
treating it as managed. It's the one write in an otherwise read-only pull/adopt flow. Takes the same
`<kind>:<id>` argument as `pull --resource` (e.g. `tag:generate_lead_tag`). For GTM kinds
(`folder`/`variable`/`trigger`/`tag`) it re-submits the matching live object with an ownership marker
in its `notes` field, with no functional change to the object itself. For GA4 kinds
(`dimension`/`metric`/`keyEvent`) it records the resource as managed in `.analytics/state.json`
instead, with no live write. Prompts `Continue? [y/N]` before writing either way.

## State

`.analytics/state.json` is created and updated automatically by `plan` and `apply`. It tracks which
GA4 resources this tool owns, plus which of them are `protected: true` (its `protectedResources`
field). GTM ownership, and its own `protected` flag, are tracked differently, via a `notes` field
this tool writes onto each GTM object it manages. Resources not tracked as managed are never
touched or deleted.

`apply` holds an exclusive lock (`.analytics/state.json.lock`) for the duration of the run. Two
concurrent `apply`s against the same state file can't interleave writes: the second one fails fast
with a clear error instead of corrupting the file. If a run crashes without cleaning up, delete the
leftover `.lock` file before retrying. The state file also carries a `version` field. A version this
CLI doesn't understand fails `plan`/`apply` loudly instead of silently treating the state as empty.

Don't hand-edit `.analytics/state.json`. **Commit it.** It holds no secrets, only resource ids, and
it's the only record of which GA4 resources this tool owns. A CI runner that checks out the repo
needs this file to know what already exists, or every run tries to re-create every GA4 resource.
Keep your real `analytics/.env.analytics` file gitignored instead, and commit only
`.env.analytics.example`.

## Output contract

`gtm-code plan` is the command scripts and the companion GitHub Action are meant to parse. Its
`--format json` and exit codes are treated as stable; a breaking change to either is a major-version
change for this package.

`--format json` prints:

```json
{
  "hasChanges": true,
  "counts": { "create": 1, "update": 0, "delete": 0 },
  "changes": [{ "operation": "create", "type": "gtm.trigger", "id": "generate_lead" }]
}
```

`operation` is `"create"`, `"update"`, or `"delete"`. `type` is the resource type as it appears in
`plan`'s text output (`gtm.variable`, `gtm.trigger`, `gtm.tag`, `ga4.dimension`, `ga4.metric`,
`ga4.keyEvent`). `id` is the logical id from your config, the same one that appears as a YAML key
under `events:`, `gtm:`, or `ga4:`.

`--format markdown` prints a one-line counts summary and a table with the same three columns,
formatted so a caller can post it as a PR comment as-is:

```markdown
**GTM as Code plan**

1 to create, 0 to update, 0 to delete

| Action | Kind | Id |
| --- | --- | --- |
| + create | trigger | `generate_lead` |
```

Exit codes: `0` when the plan has no changes, `2` when it does, `1` on error, the same three-way
convention as `terraform plan -detailed-exitcode`. `apply` and `rollback` use the plain `0`/`1`
convention instead: once they've run, there's no "pending" state left to signal.

## CI/CD

The quickest way is the companion action:

```yaml
- uses: StackMade/gtm-as-code-action@v0
  with:
    command: plan
```

See [gtm-as-code-action](https://github.com/StackMade/gtm-as-code-action) for its inputs. It
installs this CLI from npm at a pinned version, so its own tag tells you which CLI you get.

To call the CLI directly instead:

```yaml
name: gtm-as-code

on:
  pull_request:
  push:
    branches: [main]

jobs:
  plan:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - run: npm ci
      - run: npx gtm-code validate
      - run: npx gtm-code plan
        env:
          GOOGLE_APPLICATION_CREDENTIALS: ${{ secrets.GOOGLE_APPLICATION_CREDENTIALS_PATH }}
          GTM_ACCOUNT_ID: ${{ secrets.GTM_ACCOUNT_ID }}
          GTM_CONTAINER_ID: ${{ secrets.GTM_CONTAINER_ID }}
          GA4_PROPERTY_ID: ${{ secrets.GA4_PROPERTY_ID }}

  apply:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - run: npm ci
      - run: npx gtm-code apply --auto-approve
        env:
          GOOGLE_APPLICATION_CREDENTIALS: ${{ secrets.GOOGLE_APPLICATION_CREDENTIALS_PATH }}
          GTM_ACCOUNT_ID: ${{ secrets.GTM_ACCOUNT_ID }}
          GTM_CONTAINER_ID: ${{ secrets.GTM_CONTAINER_ID }}
          GA4_PROPERTY_ID: ${{ secrets.GA4_PROPERTY_ID }}
```

Use a real credential-loading action, or Workload Identity Federation, to populate
`GOOGLE_APPLICATION_CREDENTIALS`, and adapt this to whatever your organization already uses.
`apply` only writes to the GTM workspace; add a `run: npx gtm-code publish` step after it if you
want every push to `main` to also go live.

GA4 ownership tracking works in CI as long as `.analytics/state.json` is committed (see
[State](#state) above), so a fresh checkout already knows which GA4 resources this tool manages.

## Roadmap / not yet implemented

Not available yet. These are known gaps, so please don't file a bug for them:

- `gtm-code verify`, `gtm-code docs`, `gtm-code doctor`
- `gtm-code generate` (typed event helpers)
- `gtm-code migrate`
- GTM custom templates; conversion linker and community-gallery template tags (their payloads need
  fields, like Floodlight ids or a gallery template's own parameter schema, this tool can't
  live-verify against a sandbox container). See [Schema](#schema) for what is covered
- GA4 data streams, enhanced measurement, audiences, and property settings

There is deliberately no `action.yml` in this repository. The GitHub Action ships from
[StackMade/gtm-as-code-action](https://github.com/StackMade/gtm-as-code-action) so that its version
tags don't share a namespace with this package's npm releases.

See [ROADMAP.md](./ROADMAP.md) for what's planned and in what order.

## Releasing

Versions come from [Changesets](https://github.com/changesets/changesets), not from editing
`package.json` by hand. If a pull request changes something a user of the package would notice,
run `npx changeset`, pick the bump level, write a line of summary, and commit the generated file
in `.changeset/` alongside the code. Docs, CI and internal refactors don't need one.

Merging to `main` opens a pull request titled "Release" that carries the version bump and the
`CHANGELOG.md` entries. Merging that pull request publishes to npm with provenance, pushes the
`v*` tag and creates the GitHub release.

## About

<a href="https://stackmade.pl">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/stackmade-logo-on-dark.svg">
    <img src="./assets/stackmade-logo-on-light.svg" alt="StackMade" height="32">
  </picture>
</a>

Built by [StackMade](https://stackmade.pl) - a family of small, focused tools shipped as
code-first products.

Maintained by [Krzysztof Słomka](https://slomka.pro), software architect specializing in fintech,
distributed systems and event-driven architectures.

## License

MIT, see [LICENSE](./LICENSE).

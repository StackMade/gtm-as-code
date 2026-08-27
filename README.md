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

### Schema

```yaml
version: 1                     # only 1 is accepted

project:
  name: string

google:
  gtm:
    accountId: string
    containerId: string
    workspace: string          # optional

  ga4:
    propertyId: string
    measurementId: string      # optional

events:
  <event_name>:
    description: string        # optional
    keyEvent: boolean          # optional
    parameters:
      <param_name>:
        type: string | number | boolean
        dimension: boolean     # optional, also registers this parameter as a GA4 dimension
        optional: boolean      # optional

gtm:
  variables:
    <name>: { type: string, ... }
  triggers:
    <name>: { type: string, ... }
  tags:
    <name>: { type: string, trigger: [string, ...], ... }   # trigger references trigger names above

ga4:
  dimensions:
    <name>: { scope: event | user, parameter: string }
  metrics:
    <name>: { scope: event | user, parameter: string, measurementUnit: string }  # measurementUnit optional
  keyEvents:
    <name>: {}
```

Only `type` (and, for tags, `trigger`) is schema-validated on `gtm.variables`, `gtm.triggers` and
`gtm.tags` entries today. Per-resource-type property shapes aren't validated yet.

Validation also catches:
- unknown top-level or nested keys (with a "did you mean" suggestion),
- the same resource id defined twice across `gtm.*` and `ga4.*`,
- a tag's `trigger` referencing a trigger name that doesn't exist.

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

`--format json` prints `{ "hasChanges": boolean, "counts": { "create", "update", "delete" },
"changes": [{ "operation", "type", "id" }] }`, meant for a CI step to parse. `--format markdown`
prints a counts line and a table, one row per change, meant to be posted as a PR comment as-is.

`plan` exits `0` when there's nothing to do, `2` when the plan has changes, and `1` on error, so a
CI step can branch on the exit code without parsing output at all (the same three-way convention as
`terraform plan -detailed-exitcode`). `apply` and `rollback` keep the plain `0`/`1` convention:
once they've run, there's no "pending" state left to signal.

### `gtm-code apply [--auto-approve] [--allow-destroy]`

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

### `gtm-code publish`

Creates a GTM container version from the current workspace and publishes it. The version name and
notes are taken from the current commit (short SHA and subject line) when run inside a git
checkout, so the GTM version history stays readable against your commit history. Requires the
`tagmanager.publish` scope in addition to the ones `apply` already needs.

### `gtm-code rollback [--auto-approve]`

Republishes the container version that was live immediately before the current one. Prints both
versions and prompts `Continue? [y/N]` unless `--auto-approve` is passed. Does nothing to the
workspace or to `.analytics/state.json`; it only changes which already-existing version is live, so
it's close to free to run once `publish` has created a version history to roll back through.

## State

`.analytics/state.json` is created and updated automatically by `plan` and `apply`. It tracks which
GA4 resources this tool owns. GTM ownership is tracked differently, via a `notes` field this tool
writes onto each GTM object it manages. Resources not tracked as managed are never touched or
deleted.

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

- `gtm-code pull` (import existing GTM/GA4 resources into config)
- `gtm-code diff`, `gtm-code verify`, `gtm-code docs`, `gtm-code doctor`
- `gtm-code generate` (typed event helpers)
- `gtm-code migrate`
- Drift detection
- GTM built-in variables, folders, custom templates, and most trigger, variable and tag types. See
  [Schema](#schema) for what is covered
- Consent Mode settings
- GA4 data streams, enhanced measurement, audiences, and property settings

There is deliberately no `action.yml` in this repository. The GitHub Action ships from
[StackMade/gtm-as-code-action](https://github.com/StackMade/gtm-as-code-action) so that its version
tags don't share a namespace with this package's npm releases.

See [ROADMAP.md](./ROADMAP.md) for what's planned and in what order.

## License

MIT, see [LICENSE](./LICENSE).

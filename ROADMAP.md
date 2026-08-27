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

## 0.2: safe to run unattended

The gate for using this in CI at all. Nothing here is a new feature; all of it closes a way the
current tool can be wrong.

- Exit codes. Distinct codes for "no changes", "changes pending", and "error", so CI can branch on
  them.
- The output contract the GitHub Action consumes. See below.

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

Outputs are the part that is still missing: `has-changes` plus create, update and delete counts and
the rendered plan, so a caller can branch, gate an environment, or post the plan as a PR comment.
They read `--format json`, and the PR comment reads `--format markdown`, which is why they appear
under 0.2 rather than earlier. This repository's half of the work is that contract: the JSON shape
and the exit codes, documented and treated as stable, because an action in another repository parses
them.

Releases are cut by tagging `vX.Y.Z` in the action repository and force-moving the `vX` tag onto it,
which is the convention consumers already expect from every other action.

Release coordination is the one recurring chore the split introduces. Every new CLI version on npm
needs a deliberate bump of the pinned default in the action repository, followed by an action
release. It is the thing most likely to silently rot, so it is worth automating early, even if only
as a scheduled check comparing the pinned default against the latest npm version.

## 0.3: adopt an existing setup

Until this ships the tool only serves greenfield containers, which is almost none of them.

- `gtm-code pull`. Reverse-generate YAML from a live container and property. Two modes are worth
  distinguishing: import everything, to bootstrap a config, and import a named resource, to adopt
  one thing into an existing config.
- GTM container export ingest. GTM's UI exports a container as JSON. Reading that file is a faster
  and permission-free adoption path than authorizing an API pull, and it is useful for reviewing a
  container you don't have credentials for.
- Drift detection. A read-only check with a non-zero exit when live state has diverged from config.
  It is the scheduled-CI counterpart to `plan`, and the mitigation for ownership notes being
  editable by hand.
- `gtm-code diff`. Config-to-config comparison, for reviewing a change without network access.

## 0.4: GTM coverage

Today's coverage is one variable type, one trigger type, two tag types. Most real containers cannot
be expressed at all. Ordered within the milestone by how many containers each unlocks.

- Built-in variables. Toggle-only, no ownership work. Tags and triggers reference `{{Click Text}}`,
  `{{Page Path}}` and friends constantly, and without enabling them the rest of the coverage below
  is half-usable.
- Trigger types. Page view, DOM ready, window loaded, click (all elements and links), form
  submission, scroll depth, element visibility, timer, history change, JavaScript error, custom
  event with regex matching, trigger groups.
- Trigger exceptions. Blocking triggers change firing semantics and are the thing people forget
  exists. They belong with trigger coverage, not after it.
- Variable types. Constant, custom JavaScript, lookup table, regex table, URL, cookie, DOM element,
  JavaScript variable, auto-event variables, Google tag settings.
- Tag types. Custom HTML, custom image, conversion linker, and community-gallery templates, which is
  how most non-Google vendors (Meta, LinkedIn, TikTok) actually get installed.
- Tag firing behavior. Priority, once-per-event/page/ever, tag sequencing with setup and teardown
  tags, scheduling.
- Folders. Purely organizational, but a container with 200 tags and no folders is unreviewable in
  the UI, and people will not accept a tool that flattens their structure.
- Custom templates. Managing template code as files in the repo, which is where sandboxed JavaScript
  belongs anyway.

## 0.5: Consent Mode v2 and governance

The highest-value config-shaped feature that isn't coverage. Consent settings are legally required
in the EEA, tedious and error-prone to set per tag in the UI, and reviewed by people who would
rather read a diff than click through 40 tags.

- A `consent:` block. Compiles to a consent initialization tag plus per-tag consent settings, so
  consent is declared once and enforced across every tag instead of remembered individually.
- Consent lint. Fail validation when a tag that clearly needs consent doesn't declare it.
- PII lint. Flag event parameters whose names suggest personal data. GA4 forbids it, and the penalty
  is data deletion rather than a warning.
- Protected resources. Mark resources in config as requiring an explicit override to delete.

## 0.6: the tracking plan as a product

Everything here reads the config and produces something other than an API call. Cheap to build
relative to its value, because the data is already there.

- GA4 limits and naming linter, inside `validate`. Reserved event names, name-length caps, the
  per-event parameter cap, the per-property custom dimension cap, snake_case conventions. All
  offline, zero API cost, and it catches at review time what would otherwise fail mid-`apply`.
- `gtm-code docs`. Generate a data dictionary, in markdown or HTML, from `events:`. Every analytics
  team maintains this by hand in a spreadsheet that is wrong within a month.
- `gtm-code generate`. Typed event helpers from `events:`: TypeScript types plus a `track()`
  function, so a typo in an event name is a compile error rather than missing data.
- Event packs. GA4 recommended events, and ecommerce in particular, shipped as includable modules
  with typed item arrays. Ecommerce is where the parameter shapes are strict, hand-written most
  often, and wrong most often.
- Config composition. An `extends:` or `include:` mechanism so packs, and shared internal
  conventions, can be reused across repositories.

## 0.7: GA4 coverage

The Admin API surface well beyond custom dimensions. Each item is state-tracked ownership, so 0.2's
GA4 hardening is a hard prerequisite for all of it.

- Data streams and enhanced measurement. Web, iOS and Android streams, the enhanced measurement
  toggles (scroll, outbound click, site search, video, file download), and measurement protocol
  secrets. Enhanced measurement is toggle-only ownership and silently changes what gets collected,
  which makes it exactly the sort of thing that should be in version control. It also removes a
  copy-paste seam: once streams are managed, `google.ga4.measurementId` can be derived from the
  stream rather than pasted by hand into both the config and the GTM Google tag.
- Property settings. Data retention, internal and developer traffic filters, attribution settings,
  Google Signals. Governance settings that are set once, forgotten, and audited later.
- Audiences. Audience definitions as code: the largest schema surface in this milestone, and the one
  most worth reviewing in a pull request.
- Event create and modify rules. Server-side event rewriting, currently invisible to anyone reading
  the site's code.
- Calculated metrics and channel groups.
- Search Console link. Google Ads and BigQuery links are deliberately excluded, and not planned for
  any later milestone either.

## 0.8: environments and scale

- An `environments:` block and `--env`. Dev, staging and production against different containers and
  properties from one config.
- GTM environments. The API's own environment resources, distinct from the config-level concept
  above.
- Multiple containers and properties per config. Currently one of each is assumed throughout.
- Access as code. GTM user permissions and GA4 access bindings. Useful, and also the point at which
  a mistake in this tool becomes a security incident, hence last, and behind `--allow-destroy`-style
  guards.

## 0.9: verify against reality

Everything before this verifies that the configuration is what was declared. This verifies that the
data is.

- `gtm-code verify`. Query the GA4 Data API for the declared events over the last N days and report
  which ones have never been received, or are missing declared parameters. It needs a different API
  and scope than the Admin API work above, hence its own milestone. This is the check the GTM UI
  cannot give you: config can be perfect while the site never fires the event.
- `gtm-code doctor`. Check credentials, API enablement, granted scopes, and quota headroom, and
  explain what's missing instead of failing mid-run.

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

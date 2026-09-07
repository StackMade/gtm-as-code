---
'@stackmade/gtm-as-code': minor
---

An `environments:` block and `--env <name>`, the first half of ROADMAP.md milestone 0.9.

One config declares the tracking plan once and names the places it gets applied to. An environment
may override `google.gtm.{accountId,containerId,workspace}`, `google.ga4.{propertyId,measurementId}`
and `ga4.streamWebsiteUrl`; anything else in an environment body is a validation error naming the
path. Selection is resolved after `extends:` and before validation, so every command downstream sees
an ordinary config with one container and one property, and `.analytics/state.json` needs no format
change (its keys are already scoped by property id).

`--env` is required whenever the block is present, and refused when it is not. There is no default
environment: a config that declares environments is one where "which container am I about to write
to" has more than one answer, and a default there is how a staging apply reaches production. Running
without the flag lists the declared names.

**Breaking:** `--env <path>`, which loaded an env file, is now `--dotenv <path>`. Passing a path to
`--env` fails with a message naming the new flag rather than reporting a missing environment. The
default lookup is unchanged, so a run that relied on `.env.analytics` or `analytics/.env.analytics`
being picked up automatically needs no change at all.

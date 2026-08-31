---
"@stackmade/gtm-as-code": patch
---

Fixes `deepEqual` (used by `plan`/`drift`/`apply` to detect changes) reporting a permanent phantom
`update` on any GTM resource whose config never sets an optional field: Zod materializes an
optional key with value `undefined` on the desired side, the remote payload (from `fromGtmPayload`)
never carries that key at all, and `deepEqual`'s key-count comparison treated the two as different
objects forever — discovered adopting a real container where every `gtm.variables`/`gtm.triggers`
entry without a `folder` showed `~ update` with no visible field diff (`printFieldDiff`'s
`JSON.stringify`-based comparison already treated the two as equal, so the mismatch was silent).
`deepEqual` now ignores keys whose value is `undefined` on either side before comparing key counts.

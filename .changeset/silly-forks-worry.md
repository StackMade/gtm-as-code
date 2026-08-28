---
"@stackmade/gtm-as-code": minor
---

A tag's `trigger`/`exceptTrigger` can now reference GTM's built-in triggers ("All Pages",
"Initialization - All Pages") by name, resolved to their fixed numeric GTM ids rather than looked
up in `gtm.triggers`, since GTM never returns these from `triggers.list`. This unblocks a
`googleTag` tag firing on GTM's own initialization trigger, without pasting a numeric id into
config.

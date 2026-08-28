---
"@stackmade/gtm-as-code": minor
---

Add `gtm.builtInVariables` config, so `plan`/`apply`/`drift` can enable GTM built-in variables
(`Click Text`, `Page Path`, and the rest of the click/page/form/error/history/debug set). It only
enables variables; one not listed in config is left alone.

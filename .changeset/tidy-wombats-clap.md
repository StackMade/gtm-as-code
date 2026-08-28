---
"@stackmade/gtm-as-code": patch
---

Fix `gtm-code adopt`, which was implemented and tested but never registered in the CLI, so the
command didn't actually run.

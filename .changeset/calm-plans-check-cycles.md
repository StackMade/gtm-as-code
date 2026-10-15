---
"@stackmade/gtm-as-code": patch
---

Reject dependency cycles before API calls or apply writes. Correct plan/drift JSON and Markdown
for settings-only and built-in-only changes, and include settings declarations in offline diff.
Generate distinct TypeScript parameter interfaces when event names normalize to the same name
or collide with EventParams. Drop repeated `gtm.builtInVariables` names, which were enabled twice
in one request and reported as a phantom offline diff.

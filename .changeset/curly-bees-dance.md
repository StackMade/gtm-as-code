---
"@stackmade/gtm-as-code": minor
---

Add `extends:` config composition: a config can pull in `events:`, `gtm.{variables,triggers,tags,folders}:`,
and `ga4.{dimensions,metrics,keyEvents}:` entries from other YAML files, for shared conventions or
reusable packs. Resolved in `loadConfig`, so every command supports it automatically. The root
config always wins over an extends target, and a collision between two extends targets is a
validation error. Validation errors on merged-in content point at the file and line they actually
came from.

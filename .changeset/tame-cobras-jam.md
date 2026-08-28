---
"@stackmade/gtm-as-code": minor
---

Add `gtm-code docs`, generating a Markdown data dictionary from `events:`: one section per event
with its description, key-event/consent flags, and a parameter table (type, required, custom
dimension). Prints to stdout by default; `--out <path>` writes it to a file.

---
'@stackmade/gtm-as-code': patch
---

Closes the two ways a GA4 write could fail quietly.

- `apply` reads the four settings objects (`dataRetention`, `googleSignals`, `attributionSettings`,
  `enhancedMeasurement`) back after PATCHing them and compares the fields it asked for. GA4 answers
  some of those writes with a `200` and leaves the property unchanged, and these settings have no
  create/delete lifecycle to fall back on, so the only previous symptom was the next `plan` showing
  the same update again. A mismatch is now named field by field and `apply` exits non-zero, which
  makes the "run `plan` twice around every `apply`" habit unnecessary.
- `plan` refuses to plan the delete of a key event GA4 reports as not deletable, which is how it
  marks the default key events a property is created with. Dropping one from config used to produce
  a `- delete` that failed with `INVALID_ARGUMENT` part-way through every `apply`; it now fails
  offline of the write, naming the key event and both ways out (leave it declared, or unmark it in
  the GA4 UI).

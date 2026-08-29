---
"@stackmade/gtm-as-code": patch
---

Adds a remediation hint for `FAILED_PRECONDITION` errors on `ga4.googleSignals`: Google Signals
must be activated on the property through the GA4 UI once before its state can be changed via
config. Documents the same requirement in the README.

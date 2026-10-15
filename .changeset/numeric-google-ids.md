---
"@stackmade/gtm-as-code": patch
---

`google.gtm.accountId`, `google.gtm.containerId` and `google.ga4.propertyId` must now be numeric.
They go straight into Google API URL paths, so a value such as `../user_permissions/5#` could send
a request to a different endpoint than the command intended. Validation now rejects it with the
file and line.

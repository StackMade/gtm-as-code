---
"@stackmade/gtm-as-code": patch
---

Fixes `ga4.streamWebsiteUrl` lookup to ignore a trailing slash, and makes its "stream not found"
error list the web stream URLs that actually exist on the property. `plan`/`apply` also now print
which GA4 settings changed, not just that some did.

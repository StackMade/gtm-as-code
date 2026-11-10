---
'@stackmade/gtm-as-code': patch
---

`adopt` now works for `eventCreateRule`, `eventEditRule` and `measurementProtocolSecret`. It looks
them up on the stream `ga4.streamWebsiteUrl` resolves to, the same one `plan` reads. Before this,
`adopt` failed for those three with "stream-scoped but no stream was resolved". If
`ga4.streamWebsiteUrl` is unset, the error now says to set it.

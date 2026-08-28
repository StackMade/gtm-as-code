---
"@stackmade/gtm-as-code": minor
---

Adds GA4 property and stream settings as config: `ga4.dataRetention`, `ga4.googleSignals`, and
`ga4.enhancedMeasurement.{scrollsEnabled, outboundClicksEnabled, siteSearchEnabled,
videoEngagementEnabled, fileDownloadsEnabled, formInteractionsEnabled}` (the last one scoped to the
stream found via the new `ga4.streamWebsiteUrl`, which looks up an existing web data stream by URL
without creating one). These settings have no create/delete lifecycle, so `plan`/`drift`/`apply`
diff them directly against GA4's live property/stream state rather than treating them as resources.

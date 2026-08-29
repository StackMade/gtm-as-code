---
"@stackmade/gtm-as-code": minor
---

Adds `ga4.eventCreateRules`/`ga4.eventEditRules`: GA4 event create/edit rules as create/update/
delete resources, nested under the web data stream resolved from `ga4.streamWebsiteUrl`. A create
rule's config key is its `destinationEvent`; an edit rule's config key is its `displayName`. Both
support a real delete, unlike `ga4.audiences`. An edit rule's `processingOrder` is read-only
through the API and isn't part of config.

Adds `ga4.calculatedMetrics`/`ga4.channelGroups`: GA4 calculated metrics and channel groups as
property-scoped create/update/delete resources. A calculated metric's config key is its immutable
`calculatedMetricId`; a channel group's config key is its `displayName`, like `ga4.audiences`. Both
support a real delete.

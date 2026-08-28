---
"@stackmade/gtm-as-code": minor
---

Add event packs: `packs/ecommerce.yaml` and `packs/recommended.yaml`, `extends:`-able GA4
recommended events with their GA4-specified parameters. Added a `type: items` event parameter for
GA4's ecommerce item array; `gtm-code generate` emits it as `Item[]` backed by a shared `Item`
interface. Also narrowed the reserved-parameter-name lint so `currency` is only rejected when
marked `dimension: true`, GA4 reserves it for custom dimension/metric creation, not for its own
recommended events that require it as a standard parameter.

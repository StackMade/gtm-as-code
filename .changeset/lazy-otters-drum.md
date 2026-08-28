---
"@stackmade/gtm-as-code": minor
---

Add `gtm-code generate`, emitting typed event helpers from `events:`: an `EventName` union, one
params interface per event, an `EventParams` map, and a `track<E extends EventName>(event, params)`
function that pushes `{ event, ...params }` onto `window.dataLayer`. Prints to stdout by default;
`--out <path>` writes it to a file.

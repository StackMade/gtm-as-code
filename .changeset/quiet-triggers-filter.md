---
'@stackmade/gtm-as-code': minor
---

Triggers take a `filter`: the conditions GTM's own trigger editor calls "Some Clicks", "Some Link
Clicks", "Some Page Views" and so on.

```yaml
triggers:
  profile_click:
    type: linkClick
    filter:
      - { variable: '{{Click Element}}', operator: matchesCssSelector, value: '.contact .links a' }
```

Each condition maps to one entry of the trigger's GTM `filter` (`arg0` the variable, `arg1` the
value, a boolean `negate` when `negate: true`), and `pull`/`drift` read it back, so a filtered
trigger plans clean after `apply`. Operators are readable names for the API's condition types:
`equals`, `contains`, `startsWith`, `endsWith`, `matchesRegex`, `matchesCssSelector`,
`greaterThan`, `greaterOrEquals`, `lessThan`, `lessOrEquals`. `validate` rejects an unknown
operator with the nearest name (including for the API's own spelling, `cssSelector` →
`matchesCssSelector`) and a `variable` not written as `{{…}}`.

Before this, a `filter` key on a trigger passed `validate` and was silently dropped, so the trigger
fired on every event of its type.

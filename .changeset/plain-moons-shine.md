---
'@stackmade/gtm-as-code': minor
---

`gtm.environments`, the second half of ROADMAP.md milestone 0.9.

GTM's own environment objects are now managed like any other resource, through `plan`/`apply`/
`drift`/`pull`. An entry takes `url` and `enableDebug`; the config key is the environment's name in
GTM. They are container-level rather than workspace-level, confirmed live along with the rest of the
payload shape, so `apply` writes them directly instead of staging them into the workspace `publish`
later publishes.

Ownership is stamped into the object's `description`, because a GTM environment has no `notes`
field. `GtmClient` now carries the ownership field and the URL scope per kind rather than assuming
both. GTM's built-in `Live` and `Latest` environments carry no stamp, so they are never listed,
updated or deleted, and GTM refuses to delete them anyway.

`enableDebug` is always written as a boolean rather than left absent, because GTM omits a false
boolean from its responses entirely (proto3 JSON). Without that, an environment that never declares
the field would compare unequal to the live value forever, which is the phantom-diff bug 0.8.2 fixed
for GA4 settings.

Also fixes a way `apply` could report success without doing the work: a GTM resource kind absent
from the dependency graph was dropped from the create phase without a word, because creates are
driven by the graph's topological order. Environments are now nodes in it, and `apply` refuses to
run and names the resources rather than printing `Apply complete` over work it never did.

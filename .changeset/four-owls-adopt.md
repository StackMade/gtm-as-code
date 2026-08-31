---
"@stackmade/gtm-as-code": patch
---

Fixes four bugs found adopting `@stackmade/gtm-as-code` in a real project:

- `apply` no longer wipes a hand-written GTM note on `update` — `GtmClient.update` previously
  always overwrote `notes` with just the ownership stamp because the mapping layer never carries a
  `notes` field forward; it now preserves the remote object's existing user-written text.
- `publish`/`rollback` now request the `tagmanager.edit.containerversions` scope alongside
  `tagmanager.publish` — `workspaces:create_version` checks that scope specifically, and without it
  `publish` 403s even for a service account with full container-edit access.
- `google.gtm.workspace` can now be set to either a workspace id or its display name (e.g.
  "Default Workspace", as docs and `init` suggest) — `resolveWorkspaceId` looks it up instead of
  assuming it's already an id, and gives a clear error naming the field when neither matches.
- `plan`/`apply` no longer show a permanent phantom diff for a declared `enhancedMeasurement` field
  set to `false` — proto3 JSON omits `false` fields entirely, so the live value came back as
  `undefined` and compared unequal to `false` forever.

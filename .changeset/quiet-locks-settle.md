---
'@stackmade/gtm-as-code': patch
---

Removes four workarounds the tool used to push onto whoever ran it.

- `validate` now rejects a `gtm.variables`/`gtm.triggers`/`gtm.tags` `type` that has no GTM payload
  mapping, with a "did you mean" suggestion, instead of accepting it offline and failing during
  `apply` after earlier resources in the same run were already written to the workspace. The
  supported types live in `SUPPORTED_GTM_TYPES`, next to the mapping that defines them, and a test
  asserts every listed name really maps.
- A new global `--env <path>` flag, plus automatic pickup of `.env.analytics` or
  `analytics/.env.analytics` when one exists, so the file `init` scaffolds no longer has to be
  sourced into the shell before every local run. A variable already present in the environment is
  never overwritten, so a CI `env:` block still wins. The flag is `--env` and not `--env-file`
  because Node reserves the latter: it scans the whole command line for it and exits with its own
  error before this CLI runs.
- `apply`/`rollback` decline immediately, naming `--auto-approve`, when there is no terminal to
  answer `Continue? [y/N]`. Previously the prompt waited on a stream that would never send a line,
  so a scripted run hung and Node reported "Detected unsettled top-level await" instead of the
  missing flag. `adopt` declines the same way, but says it only runs interactively, since it has no
  such flag to offer.
- `apply` takes over a state lock left behind by a process that no longer exists, rather than
  requiring `.analytics/state.json.lock` to be deleted by hand after a run was killed. A lock whose
  pid is still running, or that holds no readable pid (a lock from another machine), is still
  refused.

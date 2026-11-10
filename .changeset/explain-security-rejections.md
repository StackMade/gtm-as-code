---
'@stackmade/gtm-as-code': patch
---

The env-file warning and the `extends:` and `__proto__` errors added in 0.11.1 now say why the CLI
rejected the input and how to fix it. The `extends:` error also shows where a symlink resolves. A
variable already set in the environment no longer triggers the env-file warning.

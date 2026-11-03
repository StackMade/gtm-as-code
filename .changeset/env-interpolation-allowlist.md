---
'@stackmade/gtm-as-code': minor
---

`${VAR}` interpolation only resolves variables whose names start with `GTM_`, `GA4_` or
`ANALYTICS_`. Before this, a pull request could put `${SOME_CI_SECRET}` into the config and read the
value back from `validate` or `plan` output in the job log.

To use any other name, list it in `GTM_CODE_ALLOW_ENV` (comma-separated) in the shell or in the
workflow's `env:` block. An env file cannot set `GTM_CODE_ALLOW_ENV`, because an env file can be
part of the same pull request.

**Breaking:** a config that interpolates a variable outside those prefixes now fails validation
with "Environment variable not allowed". Rename the variable, or add it to `GTM_CODE_ALLOW_ENV`.

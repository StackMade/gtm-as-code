---
'@stackmade/gtm-as-code': patch
---

Closes three ways a pull request could attack a workflow that runs `gtm-code` on its config.

An env file now only sets names the config may interpolate: `GTM_`, `GA4_`, `ANALYTICS_`, or names
listed in `GTM_CODE_ALLOW_ENV`. Before this, a committed `.env.analytics` could set
`GOOGLE_APPLICATION_CREDENTIALS` and `GOOGLE_EXTERNAL_ACCOUNT_ALLOW_EXECUTABLES` to run a command,
or `HTTPS_PROXY` and `NODE_TLS_REJECT_UNAUTHORIZED` to intercept the Google access token.

`extends:` can no longer leave the git checkout, directly or through a symlink, and a YAML parse
error no longer quotes the source. Before this, `extends:` could point at a file outside the
repository and print part of it in the job log.

A config key named `__proto__` is now rejected. It used to hide its subtree from validation.

**Breaking:** other variables in an env file, `GOOGLE_APPLICATION_CREDENTIALS` included, are ignored
with a warning. Set them in the shell or the workflow's `env:` block. An `extends:` target outside
the checkout now fails validation.

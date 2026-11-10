import { ConfigError } from './errors.js';
import { locateLine, locateFile, type ParsedConfig } from './parser.js';

const VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(:-([^}]*))?\}/g;

/**
 * The config is often changed by a pull request, and `validate`/`plan` print config values. If any
 * variable could be interpolated, a PR could write `${SOME_CI_SECRET}` into a field and read it back
 * from the job log. Only these prefixes resolve by default; anything else has to be named in
 * `GTM_CODE_ALLOW_ENV`, which the workflow sets and a PR cannot.
 */
const ALLOWED_PREFIXES = ['GTM_', 'GA4_', 'ANALYTICS_'];
export const ALLOW_ENV_VAR = 'GTM_CODE_ALLOW_ENV';

export function isAllowed(name: string, env: NodeJS.ProcessEnv): boolean {
  if (ALLOWED_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
  return (env[ALLOW_ENV_VAR] ?? '').split(',').map((entry) => entry.trim()).includes(name);
}

/** Resolves `${VAR}` / `${VAR:-default}` in every string leaf of the parsed config. */
export function interpolateConfig(
  parsed: ParsedConfig,
  env: NodeJS.ProcessEnv = process.env,
): unknown {
  return interpolateValue(parsed.data, [], parsed, env);
}

function interpolateValue(
  value: unknown,
  path: string[],
  parsed: ParsedConfig,
  env: NodeJS.ProcessEnv,
): unknown {
  if (typeof value === 'string') return interpolateString(value, path, parsed, env);
  if (Array.isArray(value)) {
    return value.map((item, index) => interpolateValue(item, [...path, String(index)], parsed, env));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      // Assigning this key sets the prototype, which hides the subtree from validateConfig's own-key checks.
      if (key === '__proto__') {
        throw new ConfigError(locateFile(parsed, path), locateLine(parsed, path), [...path, key].join('.'), [
          { label: 'Not allowed', value: 'a key named __proto__' },
        ]);
      }
      result[key] = interpolateValue(item, [...path, key], parsed, env);
    }
    return result;
  }
  return value;
}

function interpolateString(
  input: string,
  path: string[],
  parsed: ParsedConfig,
  env: NodeJS.ProcessEnv,
): string {
  return input.replace(VAR_PATTERN, (_match, name: string, _hasDefault: string, fallback: string) => {
    if (!isAllowed(name, env)) {
      throw new ConfigError(locateFile(parsed, path), locateLine(parsed, path), path.join('.'), [
        { label: 'Environment variable not allowed', value: name },
        {
          label: 'Allowed',
          value: `names starting with ${ALLOWED_PREFIXES.join(', ')}, or listed in ${ALLOW_ENV_VAR} (comma-separated, set by the workflow, not a .env file)`,
        },
      ]);
    }
    const resolved = env[name];
    if (resolved !== undefined) return resolved;
    if (fallback !== undefined) return fallback;
    throw new ConfigError(locateFile(parsed, path), locateLine(parsed, path), path.join('.'), [
      { label: 'Missing environment variable', value: name },
    ]);
  });
}

import { ConfigError } from './errors.js';
import { locateLine, type ParsedConfig } from './parser.js';

const VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(:-([^}]*))?\}/g;

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
    const resolved = env[name];
    if (resolved !== undefined) return resolved;
    if (fallback !== undefined) return fallback;
    throw new ConfigError(parsed.file, locateLine(parsed, path), path.join('.'), [
      { label: 'Missing environment variable', value: name },
    ]);
  });
}

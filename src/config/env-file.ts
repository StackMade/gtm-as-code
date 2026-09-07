import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Same shape as the config candidates in `loader.ts`, and the paths `init` scaffolds. */
const DEFAULT_CANDIDATES = ['.env.analytics', 'analytics/.env.analytics'];

/**
 * Loads `GTM_ACCOUNT_ID`/`GTM_CONTAINER_ID`/`GA4_PROPERTY_ID` and anything else the config
 * interpolates from an env file, so a local run doesn't have to source one into the shell first.
 *
 * `process.loadEnvFile` leaves an already-set variable alone, so a real environment variable (a CI
 * `env:` block, an export in the shell) still wins over the file. Returns the path that was loaded,
 * or `undefined` when there was nothing to load.
 */
export function loadEnvFile(explicitPath?: string, cwd: string = process.cwd()): string | undefined {
  if (explicitPath) {
    const path = resolve(cwd, explicitPath);
    if (!existsSync(path)) throw new Error(`Env file not found: ${explicitPath}`);
    process.loadEnvFile(path);
    return path;
  }
  for (const candidate of DEFAULT_CANDIDATES) {
    const path = resolve(cwd, candidate);
    if (!existsSync(path)) continue;
    process.loadEnvFile(path);
    return path;
  }
  return undefined;
}

/**
 * `--env` meant "path to an env file" up to 0.8.4 and means "which `environments:` entry" from 0.9.
 * A value that is obviously the old flag's argument would otherwise fail as a missing environment
 * name, which says nothing about the rename, so it is caught here and named for what it is.
 */
export function checkEnvIsNotAPath(value: string | undefined, cwd: string = process.cwd()): void {
  if (value === undefined) return;
  const looksLikeAPath = value.includes('/') || value.includes('\\') || value.startsWith('.env') || value.endsWith('.env');
  if (!looksLikeAPath && !existsSync(resolve(cwd, value))) return;
  throw new Error(
    `--env now selects an entry of the config's \`environments:\` block, and "${value}" looks like a file path. ` +
      `The flag that loads an env file is \`--dotenv\` from 0.9 onwards: use \`--dotenv ${value}\`, or drop the flag ` +
      'entirely, since .env.analytics and analytics/.env.analytics are picked up automatically.',
  );
}

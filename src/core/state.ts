import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * `.analytics/state.json` — ownership fallback for providers whose API has no
 * field to stamp ownership metadata into (GA4). GTM uses its `notes` field
 * instead and never needs this. Auto-generated, never hand-edited.
 */
export interface StateFile {
  version: 1;
  resources: Record<string, string>;
}

/** Bump when the `resources` shape changes, and add a migration in `readState`. */
export const STATE_VERSION = 1;

/** A state file whose `version` this CLI does not know how to read. */
export class StateVersionError extends Error {
  constructor(path: string, foundVersion: unknown) {
    super(
      `${path} has state version ${JSON.stringify(foundVersion)}, but this CLI only understands version ${STATE_VERSION}. ` +
        'Upgrade the CLI to a version that supports this state file, or downgrade the state file, before running apply.',
    );
    this.name = 'StateVersionError';
  }
}

export function emptyState(): StateFile {
  return { version: STATE_VERSION, resources: {} };
}

export function stateKey(provider: string, type: string, scope: string, id: string): string {
  return `${provider}:${type}:${scope}:${id}`;
}

export function recordManaged(state: StateFile, key: string, externalId: string): StateFile {
  return { ...state, resources: { ...state.resources, [key]: externalId } };
}

export function forgetManaged(state: StateFile, key: string): StateFile {
  const resources = { ...state.resources };
  delete resources[key];
  return { ...state, resources };
}

/** Reverse-looks-up the resource id for an external identifier under a given provider/type/scope prefix. */
export function findManagedId(state: StateFile, provider: string, type: string, scope: string, externalId: string): string | null {
  const prefix = `${provider}:${type}:${scope}:`;
  for (const [key, value] of Object.entries(state.resources)) {
    if (key.startsWith(prefix) && value === externalId) return key.slice(prefix.length);
  }
  return null;
}

export async function readState(path: string): Promise<StateFile> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isStateFile(parsed)) return emptyState();
    if (parsed.version !== STATE_VERSION) throw new StateVersionError(path, parsed.version);
    return parsed;
  } catch (error) {
    if (isEnoent(error)) return emptyState();
    throw error;
  }
}

/**
 * Writes to a temporary file and renames it into place, so an interrupted
 * `apply` — which writes this file once per GA4 resource it touches — leaves
 * either the old state or the new one, never a truncated file. GA4 ownership
 * exists nowhere else, so losing this file means the next `apply` re-creates
 * every resource it can no longer recognise.
 */
export async function writeState(path: string, state: StateFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(state, null, 2) + '\n', 'utf8');
  await rename(temporaryPath, path);
}

function isStateFile(value: unknown): value is StateFile {
  return typeof value === 'object' && value !== null && 'version' in value && 'resources' in value;
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'ENOENT';
}

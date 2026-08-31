import type { Change, Resource } from './resource.js';

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  // A key present with an `undefined` value (e.g. an optional Zod field the schema always
  // materializes) is indistinguishable from an absent key everywhere else in this tool —
  // JSON.stringify drops it, the Google APIs never see it — so it must not count here either,
  // or a config that never sets an optional field reports a permanent phantom `update` against
  // a remote object that never had the key at all.
  const aKeys = Object.keys(aObj).filter((k) => aObj[k] !== undefined);
  const bKeys = Object.keys(bObj).filter((k) => bObj[k] !== undefined);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => key in bObj && deepEqual(aObj[key], bObj[key]));
}

/**
 * Keys on `type:id`, not `id` alone: the event-first compiler intentionally
 * reuses the same logical id across kinds (an event's id is both its
 * trigger's and its tag's id), so `id` alone is ambiguous.
 */
function key(resource: Resource): string {
  return `${resource.type}:${resource.id}`;
}

export function diff(desired: Resource[], remote: Resource[]): Change[] {
  const remoteByKey = new Map(remote.map((resource) => [key(resource), resource]));
  const desiredKeys = new Set(desired.map(key));
  const changes: Change[] = [];

  for (const after of desired) {
    const before = remoteByKey.get(key(after));
    if (!before) {
      changes.push({ operation: 'create', resource: after });
    } else if (!deepEqual(before.desiredState, after.desiredState)) {
      changes.push({ operation: 'update', before, after });
    }
  }

  for (const resource of remote) {
    if (!desiredKeys.has(key(resource))) {
      changes.push({ operation: 'delete', resource });
    }
  }

  return changes;
}

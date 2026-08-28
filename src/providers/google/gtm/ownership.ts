/**
 * GTM has no custom-metadata field, so the free-text `notes` field carries
 * both the ownership marker and our logical id — that is what lets remote
 * state be filtered without an external state file.
 */
export const MANAGED_BY = 'stackmade/gtm-as-code';

const MANAGED_BY_LINE = `managed-by: ${MANAGED_BY}`;
const RESOURCE_ID_PREFIX = 'resource-id: ';
const PROTECTED_LINE = 'protected: true';

export function buildOwnershipNotes(resourceId: string, isProtected?: boolean, userNotes?: string): string {
  const lines = [MANAGED_BY_LINE, `${RESOURCE_ID_PREFIX}${resourceId}`];
  if (isProtected) lines.push(PROTECTED_LINE);
  const ownership = lines.join('\n');
  return userNotes ? `${userNotes}\n\n${ownership}` : ownership;
}

export function parseOwnershipNotes(notes: string | undefined): { resourceId: string; protected: boolean } | null {
  if (!notes) return null;
  if (!notes.includes(MANAGED_BY_LINE)) return null;
  const lines = notes.split('\n');
  const line = lines.find((l) => l.startsWith(RESOURCE_ID_PREFIX));
  if (!line) return null;
  const resourceId = line.slice(RESOURCE_ID_PREFIX.length).trim();
  return resourceId ? { resourceId, protected: lines.includes(PROTECTED_LINE) } : null;
}

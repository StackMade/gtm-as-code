/** Actionable API-failure messages. */
export class GtmApiError extends Error {
  constructor(
    public readonly action: string,
    public readonly resourceId: string,
    public readonly status: string,
    options?: { cause?: unknown },
  ) {
    super(GtmApiError.format(action, resourceId, status), options);
    this.name = 'GtmApiError';
  }

  private static format(action: string, resourceId: string, status: string): string {
    const parts = [`Unable to ${action} "${resourceId}".`, '', 'Google API:', status];
    const hint = REMEDIATION[status];
    if (hint) parts.push('', hint);
    return parts.join('\n');
  }
}

/** The GTM workspace has changes `apply` didn't make and GTM can't auto-merge — most likely a human editing it in the UI. */
export class WorkspaceConflictError extends Error {
  constructor(containerId: string) {
    super(
      `GTM workspace for container "${containerId}" has unresolved changes apply can't safely merge.\n\n` +
        'Someone may have edited this workspace directly in the GTM UI. Resolve the conflict there ' +
        '(discard the UI changes, or move them to a different workspace) before running apply again.',
    );
    this.name = 'WorkspaceConflictError';
  }
}

const REMEDIATION: Record<string, string> = {
  RESOURCE_EXHAUSTED: 'Your GTM container may have reached a resource limit, or the API quota was exceeded.',
  PERMISSION_DENIED: 'The authenticated account needs Edit access on this GTM container.',
  NOT_FOUND: 'The account/container/workspace id may be wrong, or the resource was deleted remotely.',
  ALREADY_EXISTS: 'A resource with this name already exists in the container.',
};

interface GoogleApiErrorBody {
  error?: { status?: string; message?: string };
}

/** Extracts the Google API `status` (e.g. RESOURCE_EXHAUSTED) from a failed fetch/request. */
export function extractApiStatus(error: unknown): string {
  const body = extractErrorBody(error);
  return body?.error?.status ?? (error instanceof Error ? error.message : String(error));
}

/**
 * Extracts Google's full error `message` (e.g. "Analytics Data API has not been used in project
 * ... or it is disabled"), unlike `extractApiStatus` which only carries the short status enum.
 * `doctor` needs this to tell "API disabled" apart from "permission denied" — both come back as
 * the same `PERMISSION_DENIED` status.
 */
export function extractApiMessage(error: unknown): string {
  const body = extractErrorBody(error);
  return body?.error?.message ?? (error instanceof Error ? error.message : String(error));
}

function extractErrorBody(error: unknown): GoogleApiErrorBody | null {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { response?: { data?: unknown }; code?: number; message?: string };
    if (candidate.response?.data && typeof candidate.response.data === 'object') {
      return candidate.response.data as GoogleApiErrorBody;
    }
  }
  return null;
}

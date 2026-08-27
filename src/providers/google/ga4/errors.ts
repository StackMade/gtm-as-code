import { extractApiStatus } from '../gtm/errors.js';

export { extractApiStatus };

/** Actionable API-failure messages. */
export class Ga4ApiError extends Error {
  constructor(
    public readonly action: string,
    public readonly resourceId: string,
    public readonly status: string,
    options?: { cause?: unknown },
  ) {
    super(Ga4ApiError.format(action, resourceId, status), options);
    this.name = 'Ga4ApiError';
  }

  private static format(action: string, resourceId: string, status: string): string {
    const parts = [`Unable to ${action} "${resourceId}".`, '', 'Google API:', status];
    const hint = REMEDIATION[status];
    if (hint) parts.push('', hint);
    return parts.join('\n');
  }
}

const REMEDIATION: Record<string, string> = {
  RESOURCE_EXHAUSTED: 'Your GA4 property may have reached its custom dimension/metric/key event limit.',
  PERMISSION_DENIED: 'The authenticated account needs Editor access on this GA4 property.',
  NOT_FOUND: 'The property id may be wrong, or the resource was deleted remotely.',
  ALREADY_EXISTS: 'A resource with this name already exists on the property.',
  INVALID_ARGUMENT: 'GA4 rejected one of the field values — see the Google API detail above.',
};

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
    const hint = status === 'FAILED_PRECONDITION' ? FAILED_PRECONDITION_HINTS.find((h) => action.includes(h.actionContains))?.hint : REMEDIATION[status];
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

/** `FAILED_PRECONDITION` covers unrelated GA4 requirements this tool can't satisfy through the
 *  API — the hint has to be picked by what was being done, not just the status code. */
const FAILED_PRECONDITION_HINTS: Array<{ actionContains: string; hint: string }> = [
  {
    actionContains: 'googleSignals',
    hint:
      'Google Signals must first be activated on the property through the GA4 UI (accepting its terms) ' +
      'before its state can be changed here.',
  },
  {
    actionContains: 'measurementProtocolSecret',
    hint:
      'The property must first have its User Data Collection Acknowledgement attested through the GA4 UI ' +
      '(Admin → Data Settings → Data Collection) before measurement protocol secrets can be created.',
  },
];

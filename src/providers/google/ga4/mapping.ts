import type { Ga4Kind, Ga4Object } from './client.js';

export function toGa4Payload(kind: Ga4Kind, resourceId: string, desiredState: Record<string, unknown>): Ga4Object {
  if (kind === 'dimension') {
    return {
      parameterName: String(desiredState.parameter),
      displayName: resourceId,
      scope: String(desiredState.scope).toUpperCase(),
    };
  }

  if (kind === 'metric') {
    return {
      parameterName: String(desiredState.parameter),
      displayName: resourceId,
      measurementUnit: String(desiredState.measurementUnit ?? 'standard').toUpperCase(),
    };
  }

  return {
    eventName: resourceId,
    countingMethod: String(desiredState.countingMethod ?? 'ONCE_PER_EVENT'),
  };
}

export function fromGa4Payload(kind: Ga4Kind, object: Ga4Object): Record<string, unknown> {
  if (kind === 'dimension') {
    return { scope: String(object.scope).toLowerCase(), parameter: object.parameterName };
  }

  if (kind === 'metric') {
    return { scope: String(object.scope).toLowerCase(), parameter: object.parameterName, measurementUnit: String(object.measurementUnit).toLowerCase() };
  }

  return {};
}

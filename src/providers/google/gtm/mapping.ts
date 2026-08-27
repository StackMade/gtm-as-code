import type { GtmKind, GtmObject } from './client.js';

/**
 * Payload shapes below were confirmed live against a real GTM container
 * (create → inspect the stored object), not taken from the API docs.
 */

export interface MappingContext {
  /** Measurement id (G-XXXXXXX) for a `ga4Event` tag, if not already on its desired state. */
  measurementId?: string;
  /** Logical trigger id -> GTM's own numeric trigger id, for `firingTriggerId`. */
  triggerGtmIds?: Record<string, string>;
}

export function toGtmPayload(
  kind: GtmKind,
  resourceId: string,
  desiredState: Record<string, unknown>,
  context: MappingContext = {},
): GtmObject {
  const type = String(desiredState.type);

  if (kind === 'variable' && type === 'dataLayerVariable') {
    return {
      name: resourceId,
      type: 'v',
      parameter: [{ type: 'template', key: 'name', value: String(desiredState.variableName) }],
    };
  }

  if (kind === 'trigger' && type === 'customEvent') {
    return {
      name: resourceId,
      type: 'customEvent',
      customEventFilter: [
        {
          type: 'equals',
          parameter: [
            { type: 'template', key: 'arg0', value: '{{_event}}' },
            { type: 'template', key: 'arg1', value: String(desiredState.eventName) },
          ],
        },
      ],
    };
  }

  if (kind === 'tag' && type === 'ga4Event') {
    const parameters = (desiredState.parameters ?? {}) as Record<string, string>;
    const measurementId = context.measurementId ?? (desiredState.measurementId as string | undefined);
    const triggerIds = (desiredState.trigger as string[] | undefined) ?? [];
    const payload: GtmObject = {
      name: resourceId,
      type: 'gaawe',
      parameter: [
        { type: 'template', key: 'eventName', value: String(desiredState.eventName) },
        { type: 'boolean', key: 'sendEcommerceData', value: 'false' },
        ...(measurementId ? [{ type: 'template', key: 'measurementIdOverride', value: measurementId }] : []),
        {
          type: 'list',
          key: 'eventSettingsTable',
          list: Object.entries(parameters).map(([name, value]) => ({
            type: 'map',
            map: [
              { type: 'template', key: 'parameter', value: name },
              { type: 'template', key: 'parameterValue', value },
            ],
          })),
        },
      ],
    };
    const firingTriggerId = triggerIds.map((id) => context.triggerGtmIds?.[id]).filter((id): id is string => Boolean(id));
    if (firingTriggerId.length > 0) payload.firingTriggerId = firingTriggerId;
    return payload;
  }

  if (kind === 'tag' && type === 'googleTag') {
    return {
      name: resourceId,
      type: 'googtag',
      parameter: [{ type: 'template', key: 'tagId', value: String(desiredState.measurementId) }],
    };
  }

  throw new Error(`No GTM payload mapping for ${kind} type "${type}"`);
}

export interface ReverseMappingContext {
  /** GTM's own numeric trigger id -> our logical trigger id, to recover a tag's `trigger` list. */
  triggerGtmIdToLogicalId?: Record<string, string>;
}

export function fromGtmPayload(kind: GtmKind, object: GtmObject, context: ReverseMappingContext = {}): Record<string, unknown> {
  const parameter = (object.parameter ?? []) as GtmParam[];
  const param = (key: string): string | undefined => parameter.find((p) => p.key === key)?.value;

  if (kind === 'variable' && object.type === 'v') {
    return { type: 'dataLayerVariable', variableName: param('name') };
  }

  if (kind === 'trigger' && object.type === 'customEvent') {
    const filters = (object.customEventFilter ?? []) as Array<{ parameter: GtmParam[] }>;
    const eventName = filters[0]?.parameter.find((p) => p.key === 'arg1')?.value;
    return { type: 'customEvent', eventName };
  }

  if (kind === 'tag' && object.type === 'gaawe') {
    const table = parameter.find((p) => p.key === 'eventSettingsTable');
    const parameters: Record<string, string> = {};
    for (const entry of (table?.list ?? []) as Array<{ map: GtmParam[] }>) {
      const name = entry.map.find((p) => p.key === 'parameter')?.value;
      const value = entry.map.find((p) => p.key === 'parameterValue')?.value;
      if (name !== undefined && value !== undefined) parameters[name] = value;
    }
    const firingTriggerId = (object.firingTriggerId ?? []) as string[];
    const trigger = firingTriggerId
      .map((gtmId) => context.triggerGtmIdToLogicalId?.[gtmId])
      .filter((id): id is string => Boolean(id));
    return {
      type: 'ga4Event',
      eventName: param('eventName'),
      measurementId: param('measurementIdOverride'),
      parameters,
      trigger,
    };
  }

  if (kind === 'tag' && object.type === 'googtag') {
    return { type: 'googleTag', measurementId: param('tagId') };
  }

  throw new Error(`No reverse mapping for ${kind} type "${String(object.type)}"`);
}

interface GtmParam {
  type: string;
  key: string;
  value?: string;
  list?: unknown[];
  map?: GtmParam[];
}

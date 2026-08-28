import type { GtmKind, GtmObject } from './client.js';
import { BUILT_IN_TRIGGERS, BUILT_IN_TRIGGER_IDS } from './builtin-triggers.js';

/**
 * Payload shapes below were confirmed live against a real GTM container
 * (create → inspect the stored object), not taken from the API docs.
 */

export interface MappingContext {
  /** Measurement id (G-XXXXXXX) for a `ga4Event` tag, if not already on its desired state. */
  measurementId?: string;
  /** Logical trigger id -> GTM's own numeric trigger id, for `firingTriggerId`/`blockingTriggerId`. */
  triggerGtmIds?: Record<string, string>;
  /** Logical folder id -> GTM's own numeric folder id, for `parentFolderId`. */
  folderGtmIds?: Record<string, string>;
}

/** Trigger types with no configurable fields — the GTM `type` string alone is the payload. */
const BARE_TRIGGER_TYPES = [
  'pageview',
  'domReady',
  'windowLoaded',
  'click',
  'linkClick',
  'formSubmission',
  'scrollDepth',
  'historyChange',
  'jsError',
  'consentInit',
] as const;

/** Firing behavior shared by every tag type: priority, once-per-X, scheduling, setup/teardown tags. */
function resolveTagFiringBehavior(desiredState: Record<string, unknown>): GtmObject {
  const extra: GtmObject = {};
  if (desiredState.priority !== undefined) {
    extra.priority = { type: 'integer', value: String(desiredState.priority) };
  }
  const firingOption = desiredState.firingOption as string | undefined;
  if (firingOption === 'oncePerEvent') extra.tagFiringOption = 'oncePerEvent';
  if (firingOption === 'oncePerPage') extra.tagFiringOption = 'oncePerLoad';
  if (desiredState.scheduleStart !== undefined) extra.scheduleStartMs = String(desiredState.scheduleStart);
  if (desiredState.scheduleEnd !== undefined) extra.scheduleEndMs = String(desiredState.scheduleEnd);
  const setupTags = desiredState.setupTags as string[] | undefined;
  if (setupTags && setupTags.length > 0) extra.setupTag = setupTags.map((tagName) => ({ tagName, stopOnSetupFailure: true }));
  const teardownTags = desiredState.teardownTags as string[] | undefined;
  if (teardownTags && teardownTags.length > 0) extra.teardownTag = teardownTags.map((tagName) => ({ tagName }));
  const consent = desiredState.consent as { status: 'needed' | 'notNeeded'; types?: string[] } | undefined;
  if (consent) {
    extra.consentSettings =
      consent.status === 'needed'
        ? { consentStatus: 'needed', consentType: { type: 'list', list: (consent.types ?? []).map((value) => ({ type: 'template', value })) } }
        : { consentStatus: 'notNeeded' };
  }
  return extra;
}

/** Recovers `priority`/`firingOption`/scheduling/setup-teardown from a tag's GTM object. */
function recoverTagFiringBehavior(object: GtmObject): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  const priority = object.priority as { value?: string } | undefined;
  if (priority?.value !== undefined) extra.priority = Number(priority.value);
  if (object.tagFiringOption === 'oncePerEvent') extra.firingOption = 'oncePerEvent';
  if (object.tagFiringOption === 'oncePerLoad') extra.firingOption = 'oncePerPage';
  if (object.scheduleStartMs !== undefined) extra.scheduleStart = object.scheduleStartMs;
  if (object.scheduleEndMs !== undefined) extra.scheduleEnd = object.scheduleEndMs;
  const setupTag = object.setupTag as Array<{ tagName: string }> | undefined;
  if (setupTag && setupTag.length > 0) extra.setupTags = setupTag.map((t) => t.tagName);
  const teardownTag = object.teardownTag as Array<{ tagName: string }> | undefined;
  if (teardownTag && teardownTag.length > 0) extra.teardownTags = teardownTag.map((t) => t.tagName);
  const consentSettings = object.consentSettings as
    | { consentStatus?: string; consentType?: { list?: Array<{ value?: string }> } }
    | undefined;
  if (consentSettings?.consentStatus === 'needed') {
    extra.consent = { status: 'needed', types: (consentSettings.consentType?.list ?? []).map((t) => t.value).filter(Boolean) };
  } else if (consentSettings?.consentStatus === 'notNeeded') {
    extra.consent = { status: 'notNeeded' };
  }
  return extra;
}

/** Resolves a tag's `trigger`/`exceptTrigger` logical ids to GTM's `firingTriggerId`/`blockingTriggerId`. */
function resolveTagTriggerIds(desiredState: Record<string, unknown>, context: MappingContext): GtmObject {
  const resolve = (ids: string[] | undefined) =>
    (ids ?? [])
      .map((id) => context.triggerGtmIds?.[id] ?? BUILT_IN_TRIGGERS[id])
      .filter((id): id is string => Boolean(id));
  const firingTriggerId = resolve(desiredState.trigger as string[] | undefined);
  const blockingTriggerId = resolve(desiredState.exceptTrigger as string[] | undefined);
  const extra: GtmObject = {};
  if (firingTriggerId.length > 0) extra.firingTriggerId = firingTriggerId;
  if (blockingTriggerId.length > 0) extra.blockingTriggerId = blockingTriggerId;
  return extra;
}

/** Recovers a tag's `trigger`/`exceptTrigger` logical id lists from GTM's `firingTriggerId`/`blockingTriggerId`. */
function recoverTagTriggerIds(object: GtmObject, context: ReverseMappingContext): { trigger: string[]; exceptTrigger: string[] } {
  const recover = (ids: unknown) =>
    ((ids ?? []) as string[])
      .map((gtmId) => context.triggerGtmIdToLogicalId?.[gtmId] ?? BUILT_IN_TRIGGER_IDS[gtmId])
      .filter((id): id is string => Boolean(id));
  return { trigger: recover(object.firingTriggerId), exceptTrigger: recover(object.blockingTriggerId) };
}

export function toGtmPayload(
  kind: GtmKind,
  resourceId: string,
  desiredState: Record<string, unknown>,
  context: MappingContext = {},
): GtmObject {
  if (kind === 'folder') {
    return { name: resourceId };
  }

  let payload = toGtmPayloadByType(kind, resourceId, desiredState, context);
  if (kind === 'tag') payload = { ...payload, ...resolveTagFiringBehavior(desiredState) };
  const folder = desiredState.folder as string | undefined;
  const parentFolderId = folder ? context.folderGtmIds?.[folder] : undefined;
  return parentFolderId ? { ...payload, parentFolderId } : payload;
}

function toGtmPayloadByType(
  kind: GtmKind,
  resourceId: string,
  desiredState: Record<string, unknown>,
  context: MappingContext,
): GtmObject {
  const type = String(desiredState.type);

  if (kind === 'variable' && type === 'dataLayerVariable') {
    return {
      name: resourceId,
      type: 'v',
      parameter: [{ type: 'template', key: 'name', value: String(desiredState.variableName) }],
    };
  }

  if (kind === 'variable' && type === 'constant') {
    return { name: resourceId, type: 'c', parameter: [{ type: 'template', key: 'value', value: String(desiredState.value) }] };
  }

  if (kind === 'variable' && type === 'customJavaScript') {
    return {
      name: resourceId,
      type: 'jsm',
      parameter: [{ type: 'template', key: 'javascript', value: String(desiredState.javascript) }],
    };
  }

  if (kind === 'variable' && (type === 'lookupTable' || type === 'regexTable')) {
    const map = (desiredState.map ?? []) as Array<{ key: string; value: string }>;
    const keyField = type === 'lookupTable' ? 'key' : 'pattern';
    return {
      name: resourceId,
      type: type === 'lookupTable' ? 'smm' : 'remm',
      parameter: [
        { type: 'template', key: 'input', value: String(desiredState.input) },
        { type: 'template', key: 'setDefaultValue', value: desiredState.defaultValue !== undefined ? 'true' : 'false' },
        ...(desiredState.defaultValue !== undefined
          ? [{ type: 'template', key: 'defaultValue', value: String(desiredState.defaultValue) }]
          : []),
        {
          type: 'list',
          key: 'map',
          list: map.map((entry) => ({
            type: 'map',
            map: [
              { type: 'template', key: 'key', value: String((entry as unknown as Record<string, string>)[keyField]) },
              { type: 'template', key: 'value', value: entry.value },
            ],
          })),
        },
      ],
    };
  }

  if (kind === 'variable' && type === 'url') {
    return { name: resourceId, type: 'u', parameter: [{ type: 'template', key: 'component', value: String(desiredState.component) }] };
  }

  if (kind === 'variable' && type === 'cookie') {
    return { name: resourceId, type: 'k', parameter: [{ type: 'template', key: 'name', value: String(desiredState.name) }] };
  }

  if (kind === 'variable' && type === 'domElement') {
    return { name: resourceId, type: 'd', parameter: [{ type: 'template', key: 'elementId', value: String(desiredState.elementId) }] };
  }

  if (kind === 'variable' && type === 'javascriptVariable') {
    return { name: resourceId, type: 'j', parameter: [{ type: 'template', key: 'name', value: String(desiredState.name) }] };
  }

  if (kind === 'variable' && type === 'autoEventVariable') {
    return { name: resourceId, type: 'aev', parameter: [{ type: 'template', key: 'varType', value: String(desiredState.varType) }] };
  }

  if (kind === 'variable' && type === 'googleTagSettings') {
    return { name: resourceId, type: 'gtes' };
  }

  if (kind === 'trigger' && (BARE_TRIGGER_TYPES as readonly string[]).includes(type)) {
    return { name: resourceId, type };
  }

  if (kind === 'trigger' && type === 'elementVisibility') {
    return {
      name: resourceId,
      type: 'elementVisibility',
      parameter: [
        { type: 'template', key: 'selectorType', value: String(desiredState.selectorType) },
        { type: 'template', key: 'elementSelector', value: String(desiredState.elementSelector) },
      ],
    };
  }

  if (kind === 'trigger' && type === 'timer') {
    return {
      name: resourceId,
      type: 'timer',
      interval: { type: 'template', value: String(desiredState.interval) },
      ...(desiredState.limit !== undefined ? { limit: { type: 'template', value: String(desiredState.limit) } } : {}),
    };
  }

  if (kind === 'trigger' && type === 'triggerGroup') {
    const triggers = (desiredState.triggers as string[] | undefined) ?? [];
    const triggerIds = triggers.map((id) => context.triggerGtmIds?.[id]).filter((id): id is string => Boolean(id));
    return {
      name: resourceId,
      type: 'triggerGroup',
      parameter: [{ type: 'list', key: 'triggerIds', list: triggerIds.map((value) => ({ type: 'template', value })) }],
    };
  }

  if (kind === 'trigger' && type === 'customEvent') {
    return {
      name: resourceId,
      type: 'customEvent',
      customEventFilter: [
        {
          type: desiredState.eventNameMatchType === 'regex' ? 'matchRegex' : 'equals',
          parameter: [
            { type: 'template', key: 'arg0', value: '{{_event}}' },
            { type: 'template', key: 'arg1', value: String(desiredState.eventName) },
          ],
        },
      ],
    };
  }

  if (kind === 'tag' && type === 'customHtml') {
    return {
      name: resourceId,
      type: 'html',
      parameter: [
        { type: 'template', key: 'html', value: String(desiredState.html) },
        { type: 'boolean', key: 'supportDocumentWrite', value: 'false' },
      ],
      ...resolveTagTriggerIds(desiredState, context),
    };
  }

  if (kind === 'tag' && type === 'customImage') {
    return {
      name: resourceId,
      type: 'img',
      parameter: [{ type: 'template', key: 'url', value: String(desiredState.url) }],
      ...resolveTagTriggerIds(desiredState, context),
    };
  }

  if (kind === 'tag' && type === 'ga4Event') {
    const parameters = (desiredState.parameters ?? {}) as Record<string, string>;
    const measurementId = context.measurementId ?? (desiredState.measurementId as string | undefined);
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
    return { ...payload, ...resolveTagTriggerIds(desiredState, context) };
  }

  if (kind === 'tag' && type === 'googleTag') {
    const configParameters = (desiredState.configParameters ?? {}) as Record<string, string>;
    const payload: GtmObject = {
      name: resourceId,
      type: 'googtag',
      parameter: [
        { type: 'template', key: 'tagId', value: String(desiredState.measurementId) },
        ...(Object.keys(configParameters).length > 0
          ? [
              {
                type: 'list',
                key: 'configSettingsTable',
                list: Object.entries(configParameters).map(([name, value]) => ({
                  type: 'map',
                  map: [
                    { type: 'template', key: 'parameter', value: name },
                    { type: 'template', key: 'parameterValue', value },
                  ],
                })),
              },
            ]
          : []),
      ],
    };
    return { ...payload, ...resolveTagTriggerIds(desiredState, context) };
  }

  throw new Error(`No GTM payload mapping for ${kind} type "${type}"`);
}

export interface ReverseMappingContext {
  /** GTM's own numeric trigger id -> our logical trigger id, to recover a tag's `trigger` list. */
  triggerGtmIdToLogicalId?: Record<string, string>;
  /** GTM's own numeric folder id -> our logical folder id, to recover a resource's `folder`. */
  folderGtmIdToLogicalId?: Record<string, string>;
}

export function fromGtmPayload(kind: GtmKind, object: GtmObject, context: ReverseMappingContext = {}): Record<string, unknown> {
  if (kind === 'folder') {
    return { name: object.name };
  }

  let desiredState = fromGtmPayloadByType(kind, object, context);
  if (kind === 'tag') desiredState = { ...desiredState, ...recoverTagFiringBehavior(object) };
  const parentFolderId = object.parentFolderId as string | undefined;
  const folder = parentFolderId ? context.folderGtmIdToLogicalId?.[parentFolderId] : undefined;
  return folder ? { ...desiredState, folder } : desiredState;
}

function fromGtmPayloadByType(kind: GtmKind, object: GtmObject, context: ReverseMappingContext): Record<string, unknown> {
  const parameter = (object.parameter ?? []) as GtmParam[];
  const param = (key: string): string | undefined => parameter.find((p) => p.key === key)?.value;

  if (kind === 'variable' && object.type === 'v') {
    return { type: 'dataLayerVariable', variableName: param('name') };
  }

  if (kind === 'variable' && object.type === 'c') {
    return { type: 'constant', value: param('value') };
  }

  if (kind === 'variable' && object.type === 'jsm') {
    return { type: 'customJavaScript', javascript: param('javascript') };
  }

  if (kind === 'variable' && (object.type === 'smm' || object.type === 'remm')) {
    const table = parameter.find((p) => p.key === 'map');
    const keyField = object.type === 'smm' ? 'key' : 'pattern';
    const map = ((table?.list ?? []) as Array<{ map: GtmParam[] }>).map((entry) => ({
      [keyField]: entry.map.find((p) => p.key === 'key')?.value,
      value: entry.map.find((p) => p.key === 'value')?.value,
    }));
    const defaultValue = param('defaultValue');
    return {
      type: object.type === 'smm' ? 'lookupTable' : 'regexTable',
      input: param('input'),
      map,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
    };
  }

  if (kind === 'variable' && object.type === 'u') {
    return { type: 'url', component: param('component') };
  }

  if (kind === 'variable' && object.type === 'k') {
    return { type: 'cookie', name: param('name') };
  }

  if (kind === 'variable' && object.type === 'd') {
    return { type: 'domElement', elementId: param('elementId') };
  }

  if (kind === 'variable' && object.type === 'j') {
    return { type: 'javascriptVariable', name: param('name') };
  }

  if (kind === 'variable' && object.type === 'aev') {
    return { type: 'autoEventVariable', varType: param('varType') };
  }

  if (kind === 'variable' && object.type === 'gtes') {
    return { type: 'googleTagSettings' };
  }

  if (kind === 'trigger' && typeof object.type === 'string' && (BARE_TRIGGER_TYPES as readonly string[]).includes(object.type)) {
    return { type: object.type };
  }

  if (kind === 'trigger' && object.type === 'elementVisibility') {
    return { type: 'elementVisibility', selectorType: param('selectorType'), elementSelector: param('elementSelector') };
  }

  if (kind === 'trigger' && object.type === 'timer') {
    const interval = object.interval as { value?: string } | undefined;
    const limit = object.limit as { value?: string } | undefined;
    return {
      type: 'timer',
      interval: interval?.value,
      ...(limit?.value !== undefined ? { limit: limit.value } : {}),
    };
  }

  if (kind === 'trigger' && object.type === 'triggerGroup') {
    const table = parameter.find((p) => p.key === 'triggerIds');
    const gtmIds = ((table?.list ?? []) as Array<{ value?: string }>).map((entry) => entry.value).filter((id): id is string => Boolean(id));
    const triggers = gtmIds.map((gtmId) => context.triggerGtmIdToLogicalId?.[gtmId]).filter((id): id is string => Boolean(id));
    return { type: 'triggerGroup', triggers };
  }

  if (kind === 'trigger' && object.type === 'customEvent') {
    const filters = (object.customEventFilter ?? []) as Array<{ type: string; parameter: GtmParam[] }>;
    const eventName = filters[0]?.parameter.find((p) => p.key === 'arg1')?.value;
    return {
      type: 'customEvent',
      eventName,
      ...(filters[0]?.type === 'matchRegex' ? { eventNameMatchType: 'regex' } : {}),
    };
  }

  if (kind === 'tag' && object.type === 'html') {
    return { type: 'customHtml', html: param('html'), ...recoverTagTriggerIds(object, context) };
  }

  if (kind === 'tag' && object.type === 'img') {
    return { type: 'customImage', url: param('url'), ...recoverTagTriggerIds(object, context) };
  }

  if (kind === 'tag' && object.type === 'gaawe') {
    const table = parameter.find((p) => p.key === 'eventSettingsTable');
    const parameters: Record<string, string> = {};
    for (const entry of (table?.list ?? []) as Array<{ map: GtmParam[] }>) {
      const name = entry.map.find((p) => p.key === 'parameter')?.value;
      const value = entry.map.find((p) => p.key === 'parameterValue')?.value;
      if (name !== undefined && value !== undefined) parameters[name] = value;
    }
    return {
      type: 'ga4Event',
      eventName: param('eventName'),
      measurementId: param('measurementIdOverride'),
      parameters,
      ...recoverTagTriggerIds(object, context),
    };
  }

  if (kind === 'tag' && object.type === 'googtag') {
    const table = parameter.find((p) => p.key === 'configSettingsTable');
    const configParameters: Record<string, string> = {};
    for (const entry of (table?.list ?? []) as Array<{ map: GtmParam[] }>) {
      const name = entry.map.find((p) => p.key === 'parameter')?.value;
      const value = entry.map.find((p) => p.key === 'parameterValue')?.value;
      if (name !== undefined && value !== undefined) configParameters[name] = value;
    }
    return { type: 'googleTag', measurementId: param('tagId'), configParameters, ...recoverTagTriggerIds(object, context) };
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

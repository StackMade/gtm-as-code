import { ConfigError } from './errors.js';
import { locateLine, locateFile, type ParsedConfig } from './parser.js';
import { closestMatch } from './suggest.js';
import { BUILT_IN_VARIABLE_NAMES } from '../providers/google/gtm/builtin-variables.js';
import { BUILT_IN_TRIGGERS, BUILT_IN_TRIGGER_NAMES } from '../providers/google/gtm/builtin-triggers.js';

export interface EventParameterDef {
  /** `items` is GA4's ecommerce item array (view_item, add_to_cart, purchase, ...). */
  type: 'string' | 'number' | 'boolean' | 'items';
  dimension?: boolean;
  optional?: boolean;
}

export interface EventDef {
  description?: string;
  keyEvent?: boolean;
  parameters: Record<string, EventParameterDef>;
  /** Consent the event's compiled `ga4Event` tag requires before firing. */
  consent?: ConsentDef;
}

export interface ResourceDef {
  type: string;
  /** Folder name (from `gtm.folders`) this resource is organized under. */
  folder?: string;
  /** Require `--allow-destroy-protected` (beyond `--allow-destroy`) before `apply` may delete this resource. */
  protected?: boolean;
  [key: string]: unknown;
}

export interface ConsentDef {
  status: 'needed' | 'notNeeded';
  /** Consent types this tag needs granted (GA4's `ad_storage`, `analytics_storage`, etc). Required when `status` is `needed`. */
  types?: string[];
}

export interface TagDef extends ResourceDef {
  trigger?: string[];
  /** Trigger names that block this tag from firing (GTM's `blockingTriggerId`). */
  exceptTrigger?: string[];
  /** Tag names that must fire (and succeed) before this tag (GTM's `setupTag`). */
  setupTags?: string[];
  /** Tag names that fire after this tag (GTM's `teardownTag`). */
  teardownTags?: string[];
  /** Consent this tag requires before firing (GTM's `consentSettings`). */
  consent?: ConsentDef;
}

export interface DimensionDef {
  scope: 'event' | 'user';
  parameter: string;
  protected?: boolean;
}

export interface MetricDef {
  scope: 'event' | 'user';
  parameter: string;
  measurementUnit?: string;
  protected?: boolean;
}

export interface EnhancedMeasurementDef {
  scrollsEnabled?: boolean;
  outboundClicksEnabled?: boolean;
  siteSearchEnabled?: boolean;
  videoEngagementEnabled?: boolean;
  fileDownloadsEnabled?: boolean;
  formInteractionsEnabled?: boolean;
}

export interface AudienceEventTriggerDef {
  eventName: string;
  logCondition: string;
}

export interface AudienceStringFilterDef {
  matchType: string;
  value: string;
  caseSensitive?: boolean;
}

export interface AudienceInListFilterDef {
  values: string[];
  caseSensitive?: boolean;
}

export interface AudienceNumericFilterDef {
  operation: string;
  value: number;
}

export interface AudienceBetweenFilterDef {
  from: number;
  to: number;
}

export interface AudienceDimensionOrMetricFilterDef {
  fieldName: string;
  atAnyPointInTime?: boolean;
  inAnyNDayPeriod?: number;
  string?: AudienceStringFilterDef;
  inList?: AudienceInListFilterDef;
  numeric?: AudienceNumericFilterDef;
  between?: AudienceBetweenFilterDef;
}

export interface AudienceEventFilterDef {
  eventName: string;
  /** Itself a full filter expression, scoped to this event's parameters. */
  parameterFilter?: AudienceFilterExpressionDef;
}

/** Recursive: exactly one of `and`/`or`/`not`/`dimensionOrMetric`/`event` is set. `sequenceFilter` isn't supported yet. */
export interface AudienceFilterExpressionDef {
  and?: AudienceFilterExpressionDef[];
  or?: AudienceFilterExpressionDef[];
  not?: AudienceFilterExpressionDef;
  dimensionOrMetric?: AudienceDimensionOrMetricFilterDef;
  event?: AudienceEventFilterDef;
}

export interface AudienceFilterClauseDef {
  clauseType: 'INCLUDE' | 'EXCLUDE';
  scope: string;
  filter: AudienceFilterExpressionDef;
}

export interface AudienceDef {
  description: string;
  /** Immutable once created (GA4 API constraint) — editing it means a new audience, not an update. */
  membershipDurationDays: number;
  eventTrigger?: AudienceEventTriggerDef;
  /** Immutable once created. */
  exclusionDurationMode?: string;
  /** Immutable once created. */
  filterClauses: AudienceFilterClauseDef[];
  protected?: boolean;
}

export interface MatchingConditionDef {
  field: string;
  comparisonType: string;
  value: string;
  negated?: boolean;
}

export interface ParameterMutationDef {
  parameter: string;
  parameterValue: string;
}

/** Config key is the rule's `destinationEvent` — GA4's `EventCreateRule` has no separate label field. */
export interface EventCreateRuleDef {
  eventConditions: MatchingConditionDef[];
  sourceCopyParameters?: boolean;
  parameterMutations?: ParameterMutationDef[];
}

/** Config key is the rule's `displayName`, like `AudienceDef`. */
export interface EventEditRuleDef {
  eventConditions: MatchingConditionDef[];
  parameterMutations: ParameterMutationDef[];
}

/** Config key is `calculatedMetricId`, GA4's immutable identifier, passed at create time as a
 *  query param, not a body field. `displayName` is a separate, mutable human label. */
export interface CalculatedMetricDef {
  displayName: string;
  metricUnit: string;
  formula: string;
  description?: string;
}

export interface ChannelGroupFilterDef {
  fieldName: string;
  string?: { matchType: string; value: string };
  inList?: { values: string[] };
}

/** Recursive, like `AudienceFilterExpressionDef`, but flatter: GA4's `ChannelGroupFilter` has no
 *  dimensionOrMetric/event wrapper, just a plain `filter` leaf. */
export interface ChannelGroupFilterExpressionDef {
  and?: ChannelGroupFilterExpressionDef[];
  or?: ChannelGroupFilterExpressionDef[];
  not?: ChannelGroupFilterExpressionDef;
  filter?: ChannelGroupFilterDef;
}

export interface GroupingRuleDef {
  displayName: string;
  expression: ChannelGroupFilterExpressionDef;
}

/** Config key is the group's `displayName`, like `AudienceDef`. */
export interface ChannelGroupDef {
  description?: string;
  groupingRule: GroupingRuleDef[];
  primary?: boolean;
  protected?: boolean;
}

export interface AnalyticsConfig {
  version: 1;
  project: { name: string };
  google: {
    gtm: { accountId: string; containerId: string; workspace?: string };
    ga4: { propertyId: string; measurementId?: string };
  };
  events: Record<string, EventDef>;
  gtm: {
    variables: Record<string, ResourceDef>;
    triggers: Record<string, ResourceDef>;
    tags: Record<string, TagDef>;
    folders: Record<string, unknown>;
    builtInVariables: string[];
  };
  ga4: {
    dimensions: Record<string, DimensionDef>;
    metrics: Record<string, MetricDef>;
    keyEvents: Record<string, unknown>;
    /** The web data stream these stream-scoped settings apply to, looked up by URL, never created. */
    streamWebsiteUrl?: string;
    dataRetention?: string;
    googleSignals?: string;
    enhancedMeasurement?: EnhancedMeasurementDef;
    audiences: Record<string, AudienceDef>;
    /** Stream-scoped, like `enhancedMeasurement` — both require `streamWebsiteUrl`. */
    eventCreateRules: Record<string, EventCreateRuleDef>;
    eventEditRules: Record<string, EventEditRuleDef>;
    calculatedMetrics: Record<string, CalculatedMetricDef>;
    channelGroups: Record<string, ChannelGroupDef>;
  };
}

type Json = Record<string, unknown>;

const TOP_LEVEL_KEYS = ['version', 'project', 'google', 'events', 'gtm', 'ga4'];
const EVENT_KEYS = ['description', 'keyEvent', 'parameters', 'consent'];
const PARAMETER_KEYS = ['type', 'dimension', 'optional'];
const PARAMETER_TYPES = ['string', 'number', 'boolean', 'items'] as const;
const DIMENSION_KEYS = ['scope', 'parameter', 'protected'];
const METRIC_KEYS = ['scope', 'parameter', 'measurementUnit', 'protected'];
const SCOPES = ['event', 'user'] as const;
const GA4_TOP_LEVEL_KEYS = [
  'dimensions',
  'metrics',
  'keyEvents',
  'streamWebsiteUrl',
  'dataRetention',
  'googleSignals',
  'enhancedMeasurement',
  'audiences',
  'eventCreateRules',
  'eventEditRules',
  'calculatedMetrics',
  'channelGroups',
];
/** `RETENTION_DURATION_UNSPECIFIED` is not a settable value, so it's excluded here. */
const RETENTION_DURATIONS = ['TWO_MONTHS', 'FOURTEEN_MONTHS', 'TWENTY_SIX_MONTHS', 'THIRTY_EIGHT_MONTHS', 'FIFTY_MONTHS'] as const;
/** `GOOGLE_SIGNALS_STATE_UNSPECIFIED` is not a settable value; `*_CONSENT_*` values are output-only. */
const GOOGLE_SIGNALS_STATES = ['GOOGLE_SIGNALS_ENABLED', 'GOOGLE_SIGNALS_DISABLED'] as const;
const ENHANCED_MEASUREMENT_KEYS = [
  'scrollsEnabled',
  'outboundClicksEnabled',
  'siteSearchEnabled',
  'videoEngagementEnabled',
  'fileDownloadsEnabled',
  'formInteractionsEnabled',
];
const AUDIENCE_KEYS = ['description', 'membershipDurationDays', 'eventTrigger', 'exclusionDurationMode', 'filterClauses', 'protected'];
const AUDIENCE_EVENT_TRIGGER_KEYS = ['eventName', 'logCondition'];
const AUDIENCE_LOG_CONDITIONS = ['AUDIENCE_JOINED', 'AUDIENCE_MEMBERSHIP_RENEWED'] as const;
const AUDIENCE_EXCLUSION_DURATION_MODES = ['EXCLUDE_TEMPORARILY', 'EXCLUDE_PERMANENTLY'] as const;
const AUDIENCE_CLAUSE_TYPES = ['INCLUDE', 'EXCLUDE'] as const;
const AUDIENCE_FILTER_SCOPES = [
  'AUDIENCE_FILTER_SCOPE_WITHIN_SAME_EVENT',
  'AUDIENCE_FILTER_SCOPE_WITHIN_SAME_SESSION',
  'AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS',
] as const;
const AUDIENCE_FILTER_CLAUSE_KEYS = ['clauseType', 'scope', 'filter'];
const AUDIENCE_FILTER_EXPRESSION_KEYS = ['and', 'or', 'not', 'dimensionOrMetric', 'event'] as const;
const AUDIENCE_DIMENSION_OR_METRIC_FILTER_KEYS = ['fieldName', 'atAnyPointInTime', 'inAnyNDayPeriod', 'string', 'inList', 'numeric', 'between'];
const AUDIENCE_ONE_FILTER_KEYS = ['string', 'inList', 'numeric', 'between'] as const;
const AUDIENCE_STRING_MATCH_TYPES = ['EXACT', 'BEGINS_WITH', 'ENDS_WITH', 'CONTAINS', 'FULL_REGEXP'] as const;
const AUDIENCE_NUMERIC_OPERATIONS = ['EQUAL', 'LESS_THAN', 'GREATER_THAN'] as const;
const AUDIENCE_EVENT_FILTER_KEYS = ['eventName', 'parameterFilter'];
const MATCHING_CONDITION_KEYS = ['field', 'comparisonType', 'value', 'negated'];
/** `COMPARISON_TYPE_UNSPECIFIED` is not a settable value; `REGULAR_EXPRESSION*` are web-stream only,
 *  not enforced here since a mismatch surfaces as GA4's own error on apply. */
const COMPARISON_TYPES = [
  'EQUALS',
  'EQUALS_CASE_INSENSITIVE',
  'CONTAINS',
  'CONTAINS_CASE_INSENSITIVE',
  'STARTS_WITH',
  'STARTS_WITH_CASE_INSENSITIVE',
  'ENDS_WITH',
  'ENDS_WITH_CASE_INSENSITIVE',
  'GREATER_THAN',
  'GREATER_THAN_OR_EQUAL',
  'LESS_THAN',
  'LESS_THAN_OR_EQUAL',
  'REGULAR_EXPRESSION',
  'REGULAR_EXPRESSION_CASE_INSENSITIVE',
] as const;
const PARAMETER_MUTATION_KEYS = ['parameter', 'parameterValue'];
const EVENT_CREATE_RULE_KEYS = ['eventConditions', 'sourceCopyParameters', 'parameterMutations'];
const EVENT_EDIT_RULE_KEYS = ['eventConditions', 'parameterMutations'];
/** Confirmed live 2026-08-29: `metricUnit` is mutable via PATCH, not immutable as the docs' silence
 *  on the point might suggest. Excludes `METRIC_UNIT_UNSPECIFIED`. */
const METRIC_UNITS = ['STANDARD', 'CURRENCY', 'FEET', 'MILES', 'METERS', 'KILOMETERS', 'MILLISECONDS', 'SECONDS', 'MINUTES', 'HOURS'] as const;
const CALCULATED_METRIC_KEYS = ['displayName', 'metricUnit', 'formula', 'description'];
const CHANNEL_GROUP_KEYS = ['description', 'groupingRule', 'primary', 'protected'];
const GROUPING_RULE_KEYS = ['displayName', 'expression'];
const CHANNEL_GROUP_FILTER_EXPRESSION_KEYS = ['and', 'or', 'not', 'filter'] as const;
const CHANNEL_GROUP_FILTER_KEYS = ['fieldName', 'string', 'inList'];
const CHANNEL_GROUP_ONE_FILTER_KEYS = ['string', 'inList'] as const;
const CHANNEL_GROUP_STRING_FILTER_KEYS = ['matchType', 'value'];
const CHANNEL_GROUP_IN_LIST_KEYS = ['values'];
/** Confirmed live 2026-08-29: unlike `AudienceDimensionOrMetricFilter`'s `stringFilter`, a channel
 *  group's `stringFilter`/`inListFilter` has no `caseSensitive` field — GA4 rejects it outright. */
const CHANNEL_GROUP_STRING_MATCH_TYPES = ['EXACT', 'BEGINS_WITH', 'ENDS_WITH', 'CONTAINS', 'FULL_REGEXP', 'PARTIAL_REGEXP'] as const;

export function validateConfig(parsed: ParsedConfig): AnalyticsConfig {
  const root = requireObject(parsed, parsed.data, []);
  checkUnknownKeys(parsed, root, TOP_LEVEL_KEYS, []);

  if (root.version !== 1) {
    fail(parsed, ['version'], [
      { label: 'Expected', value: '1' },
      { label: 'Received', value: describeType(root.version) },
    ]);
  }

  const project = requireObject(parsed, root.project, ['project']);
  checkUnknownKeys(parsed, project, ['name'], ['project']);
  const projectName = requireString(parsed, project.name, ['project', 'name']);

  const google = requireObject(parsed, root.google, ['google']);
  checkUnknownKeys(parsed, google, ['gtm', 'ga4'], ['google']);

  const gtmConfig = requireObject(parsed, google.gtm, ['google', 'gtm']);
  checkUnknownKeys(parsed, gtmConfig, ['accountId', 'containerId', 'workspace'], ['google', 'gtm']);
  const accountId = requireString(parsed, gtmConfig.accountId, ['google', 'gtm', 'accountId']);
  const containerId = requireString(parsed, gtmConfig.containerId, ['google', 'gtm', 'containerId']);
  const workspace =
    gtmConfig.workspace !== undefined
      ? requireString(parsed, gtmConfig.workspace, ['google', 'gtm', 'workspace'])
      : undefined;

  const ga4Config = requireObject(parsed, google.ga4, ['google', 'ga4']);
  checkUnknownKeys(parsed, ga4Config, ['propertyId', 'measurementId'], ['google', 'ga4']);
  const propertyId = requireString(parsed, ga4Config.propertyId, ['google', 'ga4', 'propertyId']);
  const measurementId =
    ga4Config.measurementId !== undefined
      ? requireString(parsed, ga4Config.measurementId, ['google', 'ga4', 'measurementId'])
      : undefined;

  const events = validateEvents(parsed, root.events ?? {});
  const gtm = validateGtm(parsed, root.gtm ?? {});
  const ga4 = validateGa4(parsed, root.ga4 ?? {});

  checkCrossReferences(parsed, gtm, ga4);
  checkConsentLint(parsed, gtm);
  checkPiiLint(parsed, events);
  checkGa4NamingLint(parsed, events);

  return {
    version: 1,
    project: { name: projectName },
    google: {
      gtm: { accountId, containerId, workspace },
      ga4: { propertyId, measurementId },
    },
    events,
    gtm,
    ga4,
  };
}

export interface ConfigSummary {
  events: number;
  dimensions: number;
  keyEvents: number;
}

export function summarizeConfig(config: AnalyticsConfig): ConfigSummary {
  const dimensionNames = new Set(Object.keys(config.ga4.dimensions));
  const keyEventNames = new Set(Object.keys(config.ga4.keyEvents));
  for (const [name, event] of Object.entries(config.events)) {
    for (const [paramName, param] of Object.entries(event.parameters)) {
      if (param.dimension) dimensionNames.add(paramName);
    }
    if (event.keyEvent) keyEventNames.add(name);
  }
  return {
    events: Object.keys(config.events).length,
    dimensions: dimensionNames.size,
    keyEvents: keyEventNames.size,
  };
}

function validateEvents(parsed: ParsedConfig, raw: unknown): Record<string, EventDef> {
  const container = requireObject(parsed, raw, ['events']);
  const events: Record<string, EventDef> = {};
  for (const [name, value] of Object.entries(container)) {
    const path = ['events', name];
    const def = requireObject(parsed, value, path);
    checkUnknownKeys(parsed, def, EVENT_KEYS, path);
    const description =
      def.description !== undefined
        ? requireString(parsed, def.description, [...path, 'description'])
        : undefined;
    const keyEvent =
      def.keyEvent !== undefined ? requireBoolean(parsed, def.keyEvent, [...path, 'keyEvent']) : undefined;
    const parameters = validateParameters(parsed, def.parameters ?? {}, [...path, 'parameters']);
    const consent = def.consent !== undefined ? validateConsent(parsed, def.consent, [...path, 'consent']) : undefined;
    events[name] = { description, keyEvent, parameters, consent };
  }
  return events;
}

function validateParameters(
  parsed: ParsedConfig,
  raw: unknown,
  path: string[],
): Record<string, EventParameterDef> {
  const container = requireObject(parsed, raw, path);
  const result: Record<string, EventParameterDef> = {};
  for (const [name, value] of Object.entries(container)) {
    const paramPath = [...path, name];
    const def = requireObject(parsed, value, paramPath);
    checkUnknownKeys(parsed, def, PARAMETER_KEYS, paramPath);
    const type = def.type;
    if (typeof type !== 'string' || !(PARAMETER_TYPES as readonly string[]).includes(type)) {
      fail(parsed, paramPath, [
        { label: 'Expected', value: `type: ${PARAMETER_TYPES.join(' | ')}` },
        { label: 'Received', value: `type: ${describeType(type)}` },
      ]);
    }
    const dimension =
      def.dimension !== undefined
        ? requireBoolean(parsed, def.dimension, [...paramPath, 'dimension'])
        : undefined;
    if (dimension && type === 'items') {
      fail(parsed, [...paramPath, 'dimension'], [
        { label: 'A type: items parameter cannot be a dimension', value: 'GA4 custom dimensions take a single scalar value' },
      ]);
    }
    const optional =
      def.optional !== undefined
        ? requireBoolean(parsed, def.optional, [...paramPath, 'optional'])
        : undefined;
    result[name] = { type: type as EventParameterDef['type'], dimension, optional };
  }
  return result;
}

function validateGtm(parsed: ParsedConfig, raw: unknown): AnalyticsConfig['gtm'] {
  const container = requireObject(parsed, raw, ['gtm']);
  checkUnknownKeys(parsed, container, ['variables', 'triggers', 'tags', 'folders', 'builtInVariables'], ['gtm']);
  return {
    variables: validateResourceMap(parsed, container.variables ?? {}, ['gtm', 'variables']),
    triggers: validateResourceMap(parsed, container.triggers ?? {}, ['gtm', 'triggers']),
    tags: validateTagMap(parsed, container.tags ?? {}, ['gtm', 'tags']),
    folders: requireObject(parsed, container.folders ?? {}, ['gtm', 'folders']),
    builtInVariables: validateBuiltInVariables(parsed, container.builtInVariables ?? [], ['gtm', 'builtInVariables']),
  };
}

function validateBuiltInVariables(parsed: ParsedConfig, raw: unknown, path: string[]): string[] {
  const names = requireStringArray(parsed, raw, path);
  for (const [index, name] of names.entries()) {
    if (!BUILT_IN_VARIABLE_NAMES.includes(name)) {
      const suggestion = closestMatch(name, BUILT_IN_VARIABLE_NAMES);
      const body = [{ label: 'Unknown built-in variable', value: name }];
      if (suggestion) body.push({ label: 'Did you mean', value: suggestion });
      fail(parsed, [...path, String(index)], body);
    }
  }
  return names;
}

// Only `type` (and, for tags, `trigger`) is checked: per-type property shapes belong to the
// provider layer, which doesn't define them yet.
function validateResourceMap(
  parsed: ParsedConfig,
  raw: unknown,
  path: string[],
): Record<string, ResourceDef> {
  const container = requireObject(parsed, raw, path);
  const result: Record<string, ResourceDef> = {};
  for (const [name, value] of Object.entries(container)) {
    const itemPath = [...path, name];
    const def = requireObject(parsed, value, itemPath);
    const type = requireString(parsed, def.type, [...itemPath, 'type']);
    const folder = def.folder !== undefined ? requireString(parsed, def.folder, [...itemPath, 'folder']) : undefined;
    const isProtected = def.protected !== undefined ? requireBoolean(parsed, def.protected, [...itemPath, 'protected']) : undefined;
    result[name] = { ...def, type, folder, ...(isProtected !== undefined ? { protected: isProtected } : {}) };
  }
  return result;
}

function validateTagMap(parsed: ParsedConfig, raw: unknown, path: string[]): Record<string, TagDef> {
  const container = requireObject(parsed, raw, path);
  const result: Record<string, TagDef> = {};
  for (const [name, value] of Object.entries(container)) {
    const itemPath = [...path, name];
    const def = requireObject(parsed, value, itemPath);
    const type = requireString(parsed, def.type, [...itemPath, 'type']);
    const trigger =
      def.trigger !== undefined
        ? requireStringArray(parsed, def.trigger, [...itemPath, 'trigger'])
        : undefined;
    const exceptTrigger =
      def.exceptTrigger !== undefined
        ? requireStringArray(parsed, def.exceptTrigger, [...itemPath, 'exceptTrigger'])
        : undefined;
    const setupTags =
      def.setupTags !== undefined ? requireStringArray(parsed, def.setupTags, [...itemPath, 'setupTags']) : undefined;
    const teardownTags =
      def.teardownTags !== undefined
        ? requireStringArray(parsed, def.teardownTags, [...itemPath, 'teardownTags'])
        : undefined;
    const folder = def.folder !== undefined ? requireString(parsed, def.folder, [...itemPath, 'folder']) : undefined;
    const consent = def.consent !== undefined ? validateConsent(parsed, def.consent, [...itemPath, 'consent']) : undefined;
    const isProtected = def.protected !== undefined ? requireBoolean(parsed, def.protected, [...itemPath, 'protected']) : undefined;
    result[name] = {
      ...def,
      type,
      trigger,
      exceptTrigger,
      setupTags,
      teardownTags,
      folder,
      consent,
      ...(isProtected !== undefined ? { protected: isProtected } : {}),
    };
  }
  return result;
}

function validateConsent(parsed: ParsedConfig, raw: unknown, path: string[]): ConsentDef {
  const def = requireObject(parsed, raw, path);
  checkUnknownKeys(parsed, def, ['status', 'types'], path);
  const status = requireEnum(parsed, def.status, ['needed', 'notNeeded'] as const, [...path, 'status']);
  if (status === 'needed') {
    const types = requireStringArray(parsed, def.types, [...path, 'types']);
    if (types.length === 0) {
      fail(parsed, [...path, 'types'], [
        { label: 'Expected', value: 'at least one consent type' },
        { label: 'Received', value: 'empty array' },
      ]);
    }
    return { status, types };
  }
  if (def.types !== undefined) {
    fail(parsed, [...path, 'types'], [
      { label: 'Expected', value: 'no `types` (only used when `status` is `needed`)' },
      { label: 'Received', value: 'an array' },
    ]);
  }
  return { status };
}

function validateGa4(parsed: ParsedConfig, raw: unknown): AnalyticsConfig['ga4'] {
  const container = requireObject(parsed, raw, ['ga4']);
  checkUnknownKeys(parsed, container, GA4_TOP_LEVEL_KEYS, ['ga4']);

  const streamWebsiteUrl =
    container.streamWebsiteUrl !== undefined
      ? requireString(parsed, container.streamWebsiteUrl, ['ga4', 'streamWebsiteUrl'])
      : undefined;
  const dataRetention =
    container.dataRetention !== undefined
      ? requireEnum(parsed, container.dataRetention, RETENTION_DURATIONS, ['ga4', 'dataRetention'])
      : undefined;
  const googleSignals =
    container.googleSignals !== undefined
      ? requireEnum(parsed, container.googleSignals, GOOGLE_SIGNALS_STATES, ['ga4', 'googleSignals'])
      : undefined;
  const enhancedMeasurement =
    container.enhancedMeasurement !== undefined
      ? validateEnhancedMeasurement(parsed, container.enhancedMeasurement, ['ga4', 'enhancedMeasurement'])
      : undefined;
  if (enhancedMeasurement !== undefined && streamWebsiteUrl === undefined) {
    fail(parsed, ['ga4', 'enhancedMeasurement'], [
      { label: 'Expected', value: '`ga4.streamWebsiteUrl` set (enhanced measurement is a stream-scoped setting)' },
      { label: 'Received', value: 'no `ga4.streamWebsiteUrl`' },
    ]);
  }

  const eventCreateRules = validateEventCreateRules(parsed, container.eventCreateRules ?? {}, ['ga4', 'eventCreateRules']);
  const eventEditRules = validateEventEditRules(parsed, container.eventEditRules ?? {}, ['ga4', 'eventEditRules']);
  if ((Object.keys(eventCreateRules).length > 0 || Object.keys(eventEditRules).length > 0) && streamWebsiteUrl === undefined) {
    fail(parsed, ['ga4', 'streamWebsiteUrl'], [
      { label: 'Expected', value: '`ga4.streamWebsiteUrl` set (event create/edit rules are stream-scoped)' },
      { label: 'Received', value: 'no `ga4.streamWebsiteUrl`' },
    ]);
  }

  return {
    dimensions: validateDimensions(parsed, container.dimensions ?? {}, ['ga4', 'dimensions']),
    metrics: validateMetrics(parsed, container.metrics ?? {}, ['ga4', 'metrics']),
    keyEvents: requireObject(parsed, container.keyEvents ?? {}, ['ga4', 'keyEvents']),
    streamWebsiteUrl,
    dataRetention,
    googleSignals,
    enhancedMeasurement,
    audiences: validateAudiences(parsed, container.audiences ?? {}, ['ga4', 'audiences']),
    eventCreateRules,
    eventEditRules,
    calculatedMetrics: validateCalculatedMetrics(parsed, container.calculatedMetrics ?? {}, ['ga4', 'calculatedMetrics']),
    channelGroups: validateChannelGroups(parsed, container.channelGroups ?? {}, ['ga4', 'channelGroups']),
  };
}

function validateCalculatedMetrics(parsed: ParsedConfig, raw: unknown, path: string[]): Record<string, CalculatedMetricDef> {
  const container = requireObject(parsed, raw, path);
  const result: Record<string, CalculatedMetricDef> = {};
  for (const [name, value] of Object.entries(container)) {
    result[name] = validateCalculatedMetric(parsed, value, [...path, name]);
  }
  return result;
}

function validateCalculatedMetric(parsed: ParsedConfig, raw: unknown, path: string[]): CalculatedMetricDef {
  const def = requireObject(parsed, raw, path);
  checkUnknownKeys(parsed, def, CALCULATED_METRIC_KEYS, path);
  const displayName = requireString(parsed, def.displayName, [...path, 'displayName']);
  const metricUnit = requireEnum(parsed, def.metricUnit, METRIC_UNITS, [...path, 'metricUnit']);
  const formula = requireString(parsed, def.formula, [...path, 'formula']);
  const description = def.description !== undefined ? requireString(parsed, def.description, [...path, 'description']) : undefined;
  return { displayName, metricUnit, formula, ...(description !== undefined ? { description } : {}) };
}

function validateChannelGroups(parsed: ParsedConfig, raw: unknown, path: string[]): Record<string, ChannelGroupDef> {
  const container = requireObject(parsed, raw, path);
  const result: Record<string, ChannelGroupDef> = {};
  for (const [name, value] of Object.entries(container)) {
    result[name] = validateChannelGroup(parsed, value, [...path, name]);
  }
  return result;
}

function validateChannelGroup(parsed: ParsedConfig, raw: unknown, path: string[]): ChannelGroupDef {
  const def = requireObject(parsed, raw, path);
  checkUnknownKeys(parsed, def, CHANNEL_GROUP_KEYS, path);
  const description = def.description !== undefined ? requireString(parsed, def.description, [...path, 'description']) : undefined;
  const primary = def.primary !== undefined ? requireBoolean(parsed, def.primary, [...path, 'primary']) : undefined;
  const isProtected = def.protected !== undefined ? requireBoolean(parsed, def.protected, [...path, 'protected']) : undefined;

  const rulesPath = [...path, 'groupingRule'];
  if (!Array.isArray(def.groupingRule) || def.groupingRule.length === 0 || def.groupingRule.length > 50) {
    fail(parsed, rulesPath, [
      { label: 'Expected', value: 'array of 1-50 grouping rules' },
      { label: 'Received', value: Array.isArray(def.groupingRule) ? `array of ${def.groupingRule.length}` : describeType(def.groupingRule) },
    ]);
  }
  const groupingRule = def.groupingRule.map((rule, index) => validateGroupingRule(parsed, rule, [...rulesPath, String(index)]));

  return {
    groupingRule,
    ...(description !== undefined ? { description } : {}),
    ...(primary !== undefined ? { primary } : {}),
    ...(isProtected !== undefined ? { protected: isProtected } : {}),
  };
}

function validateGroupingRule(parsed: ParsedConfig, raw: unknown, path: string[]): GroupingRuleDef {
  const def = requireObject(parsed, raw, path);
  checkUnknownKeys(parsed, def, GROUPING_RULE_KEYS, path);
  return {
    displayName: requireString(parsed, def.displayName, [...path, 'displayName']),
    expression: canonicalizeChannelGroupFilterExpression(
      validateChannelGroupFilterExpression(parsed, def.expression, [...path, 'expression']),
    ),
  };
}

/** GA4 requires a grouping rule's top-level expression to be an `andGroup` of `orGroup`s, the same
 *  shape audiences require (confirmed live 2026-08-29) — normalized here for the same reason
 *  `canonicalizeAudienceFilterExpression` exists: `diff()` compares the config value directly. */
function canonicalizeChannelGroupFilterExpression(expr: ChannelGroupFilterExpressionDef): ChannelGroupFilterExpressionDef {
  if (expr.and) {
    return { and: expr.and.map((child) => (child.or !== undefined ? child : { or: [child] })) };
  }
  if (expr.or) {
    return { and: [expr] };
  }
  return { and: [{ or: [expr] }] };
}

function validateChannelGroupFilterExpression(parsed: ParsedConfig, raw: unknown, path: string[]): ChannelGroupFilterExpressionDef {
  const def = requireObject(parsed, raw, path);
  checkUnknownKeys(parsed, def, CHANNEL_GROUP_FILTER_EXPRESSION_KEYS, path);

  const present = CHANNEL_GROUP_FILTER_EXPRESSION_KEYS.filter((key) => def[key] !== undefined);
  if (present.length !== 1) {
    fail(parsed, path, [
      { label: 'Expected', value: `exactly one of ${CHANNEL_GROUP_FILTER_EXPRESSION_KEYS.join(', ')}` },
      { label: 'Received', value: present.length === 0 ? 'none' : present.join(', ') },
    ]);
  }

  const result: ChannelGroupFilterExpressionDef = {};
  if (def.and !== undefined) {
    if (!Array.isArray(def.and)) fail(parsed, [...path, 'and'], [{ label: 'Expected', value: 'array' }, { label: 'Received', value: describeType(def.and) }]);
    result.and = def.and.map((item, i) => validateChannelGroupFilterExpression(parsed, item, [...path, 'and', String(i)]));
  }
  if (def.or !== undefined) {
    if (!Array.isArray(def.or)) fail(parsed, [...path, 'or'], [{ label: 'Expected', value: 'array' }, { label: 'Received', value: describeType(def.or) }]);
    result.or = def.or.map((item, i) => validateChannelGroupFilterExpression(parsed, item, [...path, 'or', String(i)]));
  }
  if (def.not !== undefined) {
    result.not = validateChannelGroupFilterExpression(parsed, def.not, [...path, 'not']);
  }
  if (def.filter !== undefined) {
    result.filter = validateChannelGroupFilter(parsed, def.filter, [...path, 'filter']);
  }
  return result;
}

function validateChannelGroupFilter(parsed: ParsedConfig, raw: unknown, path: string[]): ChannelGroupFilterDef {
  const def = requireObject(parsed, raw, path);
  checkUnknownKeys(parsed, def, CHANNEL_GROUP_FILTER_KEYS, path);
  const fieldName = requireString(parsed, def.fieldName, [...path, 'fieldName']);

  const present = CHANNEL_GROUP_ONE_FILTER_KEYS.filter((key) => def[key] !== undefined);
  if (present.length !== 1) {
    fail(parsed, path, [
      { label: 'Expected', value: `exactly one of ${CHANNEL_GROUP_ONE_FILTER_KEYS.join(', ')}` },
      { label: 'Received', value: present.length === 0 ? 'none' : present.join(', ') },
    ]);
  }

  const result: ChannelGroupFilterDef = { fieldName };
  if (def.string !== undefined) {
    const s = requireObject(parsed, def.string, [...path, 'string']);
    checkUnknownKeys(parsed, s, CHANNEL_GROUP_STRING_FILTER_KEYS, [...path, 'string']);
    result.string = {
      matchType: requireEnum(parsed, s.matchType, CHANNEL_GROUP_STRING_MATCH_TYPES, [...path, 'string', 'matchType']),
      value: requireString(parsed, s.value, [...path, 'string', 'value']),
    };
  }
  if (def.inList !== undefined) {
    const l = requireObject(parsed, def.inList, [...path, 'inList']);
    checkUnknownKeys(parsed, l, CHANNEL_GROUP_IN_LIST_KEYS, [...path, 'inList']);
    result.inList = { values: requireStringArray(parsed, l.values, [...path, 'inList', 'values']) };
  }
  return result;
}

function validateEventCreateRules(parsed: ParsedConfig, raw: unknown, path: string[]): Record<string, EventCreateRuleDef> {
  const container = requireObject(parsed, raw, path);
  const result: Record<string, EventCreateRuleDef> = {};
  for (const [name, value] of Object.entries(container)) {
    result[name] = validateEventCreateRule(parsed, value, [...path, name]);
  }
  return result;
}

function validateEventCreateRule(parsed: ParsedConfig, raw: unknown, path: string[]): EventCreateRuleDef {
  const def = requireObject(parsed, raw, path);
  checkUnknownKeys(parsed, def, EVENT_CREATE_RULE_KEYS, path);
  const eventConditions = validateMatchingConditions(parsed, def.eventConditions, [...path, 'eventConditions']);
  const sourceCopyParameters =
    def.sourceCopyParameters !== undefined ? requireBoolean(parsed, def.sourceCopyParameters, [...path, 'sourceCopyParameters']) : undefined;
  const parameterMutations =
    def.parameterMutations !== undefined
      ? validateParameterMutations(parsed, def.parameterMutations, [...path, 'parameterMutations'])
      : undefined;
  return {
    eventConditions,
    ...(sourceCopyParameters !== undefined ? { sourceCopyParameters } : {}),
    ...(parameterMutations !== undefined ? { parameterMutations } : {}),
  };
}

function validateEventEditRules(parsed: ParsedConfig, raw: unknown, path: string[]): Record<string, EventEditRuleDef> {
  const container = requireObject(parsed, raw, path);
  const result: Record<string, EventEditRuleDef> = {};
  for (const [name, value] of Object.entries(container)) {
    result[name] = validateEventEditRule(parsed, value, [...path, name]);
  }
  return result;
}

function validateEventEditRule(parsed: ParsedConfig, raw: unknown, path: string[]): EventEditRuleDef {
  const def = requireObject(parsed, raw, path);
  checkUnknownKeys(parsed, def, EVENT_EDIT_RULE_KEYS, path);
  const eventConditions = validateMatchingConditions(parsed, def.eventConditions, [...path, 'eventConditions']);
  const parameterMutations = validateParameterMutations(parsed, def.parameterMutations, [...path, 'parameterMutations'], { requireNonEmpty: true });
  return { eventConditions, parameterMutations };
}

/** GA4 caps `eventConditions` at 1-10 entries. */
function validateMatchingConditions(parsed: ParsedConfig, raw: unknown, path: string[]): MatchingConditionDef[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 10) {
    fail(parsed, path, [
      { label: 'Expected', value: 'array of 1-10 conditions' },
      { label: 'Received', value: Array.isArray(raw) ? `array of ${raw.length}` : describeType(raw) },
    ]);
  }
  return raw.map((item, index) => validateMatchingCondition(parsed, item, [...path, String(index)]));
}

function validateMatchingCondition(parsed: ParsedConfig, raw: unknown, path: string[]): MatchingConditionDef {
  const def = requireObject(parsed, raw, path);
  checkUnknownKeys(parsed, def, MATCHING_CONDITION_KEYS, path);
  const field = requireString(parsed, def.field, [...path, 'field']);
  const comparisonType = requireEnum(parsed, def.comparisonType, COMPARISON_TYPES, [...path, 'comparisonType']);
  const value = requireString(parsed, def.value, [...path, 'value']);
  const negated = def.negated !== undefined ? requireBoolean(parsed, def.negated, [...path, 'negated']) : undefined;
  return { field, comparisonType, value, ...(negated !== undefined ? { negated } : {}) };
}

/** GA4 caps `parameterMutations` at 20 entries; `eventEditRules` additionally requires at least one. */
function validateParameterMutations(
  parsed: ParsedConfig,
  raw: unknown,
  path: string[],
  opts: { requireNonEmpty?: boolean } = {},
): ParameterMutationDef[] {
  if (!Array.isArray(raw) || raw.length > 20 || (opts.requireNonEmpty && raw.length === 0)) {
    fail(parsed, path, [
      { label: 'Expected', value: opts.requireNonEmpty ? 'array of 1-20 mutations' : 'array of at most 20 mutations' },
      { label: 'Received', value: Array.isArray(raw) ? `array of ${raw.length}` : describeType(raw) },
    ]);
  }
  return raw.map((item, index) => validateParameterMutation(parsed, item, [...path, String(index)]));
}

function validateParameterMutation(parsed: ParsedConfig, raw: unknown, path: string[]): ParameterMutationDef {
  const def = requireObject(parsed, raw, path);
  checkUnknownKeys(parsed, def, PARAMETER_MUTATION_KEYS, path);
  return {
    parameter: requireString(parsed, def.parameter, [...path, 'parameter']),
    parameterValue: requireString(parsed, def.parameterValue, [...path, 'parameterValue']),
  };
}

function validateAudiences(parsed: ParsedConfig, raw: unknown, path: string[]): Record<string, AudienceDef> {
  const container = requireObject(parsed, raw, path);
  const result: Record<string, AudienceDef> = {};
  for (const [name, value] of Object.entries(container)) {
    result[name] = validateAudience(parsed, value, [...path, name]);
  }
  return result;
}

function validateAudience(parsed: ParsedConfig, raw: unknown, path: string[]): AudienceDef {
  const def = requireObject(parsed, raw, path);
  checkUnknownKeys(parsed, def, AUDIENCE_KEYS, path);

  const description = requireString(parsed, def.description, [...path, 'description']);
  const membershipDurationDays = requireNumber(parsed, def.membershipDurationDays, [...path, 'membershipDurationDays']);
  const eventTrigger =
    def.eventTrigger !== undefined ? validateAudienceEventTrigger(parsed, def.eventTrigger, [...path, 'eventTrigger']) : undefined;
  const exclusionDurationMode =
    def.exclusionDurationMode !== undefined
      ? requireEnum(parsed, def.exclusionDurationMode, AUDIENCE_EXCLUSION_DURATION_MODES, [...path, 'exclusionDurationMode'])
      : undefined;

  const clausesPath = [...path, 'filterClauses'];
  if (!Array.isArray(def.filterClauses) || def.filterClauses.length === 0) {
    fail(parsed, clausesPath, [
      { label: 'Expected', value: 'non-empty array' },
      { label: 'Received', value: describeType(def.filterClauses) },
    ]);
  }
  const filterClauses = (def.filterClauses as unknown[]).map((clause, index) =>
    validateAudienceFilterClause(parsed, clause, [...clausesPath, String(index)]),
  );

  const isProtected = def.protected !== undefined ? requireBoolean(parsed, def.protected, [...path, 'protected']) : undefined;

  return {
    description,
    membershipDurationDays,
    filterClauses,
    ...(eventTrigger !== undefined ? { eventTrigger } : {}),
    ...(exclusionDurationMode !== undefined ? { exclusionDurationMode } : {}),
    ...(isProtected !== undefined ? { protected: isProtected } : {}),
  };
}

function validateAudienceEventTrigger(parsed: ParsedConfig, raw: unknown, path: string[]): AudienceEventTriggerDef {
  const def = requireObject(parsed, raw, path);
  checkUnknownKeys(parsed, def, AUDIENCE_EVENT_TRIGGER_KEYS, path);
  return {
    eventName: requireString(parsed, def.eventName, [...path, 'eventName']),
    logCondition: requireEnum(parsed, def.logCondition, AUDIENCE_LOG_CONDITIONS, [...path, 'logCondition']),
  };
}

function validateAudienceFilterClause(parsed: ParsedConfig, raw: unknown, path: string[]): AudienceFilterClauseDef {
  const def = requireObject(parsed, raw, path);
  checkUnknownKeys(parsed, def, AUDIENCE_FILTER_CLAUSE_KEYS, path);
  return {
    clauseType: requireEnum(parsed, def.clauseType, AUDIENCE_CLAUSE_TYPES, [...path, 'clauseType']),
    scope: requireEnum(parsed, def.scope, AUDIENCE_FILTER_SCOPES, [...path, 'scope']),
    filter: canonicalizeAudienceFilterExpression(validateAudienceFilterExpression(parsed, def.filter, [...path, 'filter'])),
  };
}

/**
 * GA4 itself requires every clause's top-level filter expression to be an `andGroup` whose direct
 * children are each an `orGroup` (confirmed live 2026-08-29: GA4 rejects both a bare leaf at the top
 * and a non-`orGroup` child of an `andGroup`). Writing that by hand for the common single-condition
 * case would be pure boilerplate, so config accepts any shape and this normalizes it to the one GA4
 * accepts. Applied once, at validation time, so both the config's own stored value (compared
 * directly in `plan`'s diff) and GA4's response (which is always already in this canonical shape)
 * end up structurally identical.
 */
function canonicalizeAudienceFilterExpression(expr: AudienceFilterExpressionDef): AudienceFilterExpressionDef {
  if (expr.and) {
    return { and: expr.and.map((child) => (child.or !== undefined ? child : { or: [child] })) };
  }
  if (expr.or) {
    return { and: [expr] };
  }
  return { and: [{ or: [expr] }] };
}

/** Recursive, and picky: GA4 itself rejects a filter expression with more than one branch set. */
function validateAudienceFilterExpression(parsed: ParsedConfig, raw: unknown, path: string[]): AudienceFilterExpressionDef {
  const def = requireObject(parsed, raw, path);
  checkUnknownKeys(parsed, def, AUDIENCE_FILTER_EXPRESSION_KEYS, path);

  const present = AUDIENCE_FILTER_EXPRESSION_KEYS.filter((key) => def[key] !== undefined);
  if (present.length !== 1) {
    fail(parsed, path, [
      { label: 'Expected', value: `exactly one of ${AUDIENCE_FILTER_EXPRESSION_KEYS.join(', ')}` },
      { label: 'Received', value: present.length === 0 ? 'none' : present.join(', ') },
    ]);
  }

  const result: AudienceFilterExpressionDef = {};
  if (def.and !== undefined) {
    if (!Array.isArray(def.and)) fail(parsed, [...path, 'and'], [{ label: 'Expected', value: 'array' }, { label: 'Received', value: describeType(def.and) }]);
    result.and = def.and.map((item, i) => validateAudienceFilterExpression(parsed, item, [...path, 'and', String(i)]));
  }
  if (def.or !== undefined) {
    if (!Array.isArray(def.or)) fail(parsed, [...path, 'or'], [{ label: 'Expected', value: 'array' }, { label: 'Received', value: describeType(def.or) }]);
    result.or = def.or.map((item, i) => validateAudienceFilterExpression(parsed, item, [...path, 'or', String(i)]));
  }
  if (def.not !== undefined) {
    result.not = validateAudienceFilterExpression(parsed, def.not, [...path, 'not']);
  }
  if (def.dimensionOrMetric !== undefined) {
    result.dimensionOrMetric = validateAudienceDimensionOrMetricFilter(parsed, def.dimensionOrMetric, [...path, 'dimensionOrMetric']);
  }
  if (def.event !== undefined) {
    result.event = validateAudienceEventFilter(parsed, def.event, [...path, 'event']);
  }
  return result;
}

function validateAudienceDimensionOrMetricFilter(
  parsed: ParsedConfig,
  raw: unknown,
  path: string[],
): AudienceDimensionOrMetricFilterDef {
  const def = requireObject(parsed, raw, path);
  checkUnknownKeys(parsed, def, AUDIENCE_DIMENSION_OR_METRIC_FILTER_KEYS, path);

  const fieldName = requireString(parsed, def.fieldName, [...path, 'fieldName']);
  const atAnyPointInTime =
    def.atAnyPointInTime !== undefined ? requireBoolean(parsed, def.atAnyPointInTime, [...path, 'atAnyPointInTime']) : undefined;
  const inAnyNDayPeriod =
    def.inAnyNDayPeriod !== undefined ? requireNumber(parsed, def.inAnyNDayPeriod, [...path, 'inAnyNDayPeriod']) : undefined;

  const present = AUDIENCE_ONE_FILTER_KEYS.filter((key) => def[key] !== undefined);
  if (present.length !== 1) {
    fail(parsed, path, [
      { label: 'Expected', value: `exactly one of ${AUDIENCE_ONE_FILTER_KEYS.join(', ')}` },
      { label: 'Received', value: present.length === 0 ? 'none' : present.join(', ') },
    ]);
  }

  const result: AudienceDimensionOrMetricFilterDef = {
    fieldName,
    ...(atAnyPointInTime !== undefined ? { atAnyPointInTime } : {}),
    ...(inAnyNDayPeriod !== undefined ? { inAnyNDayPeriod } : {}),
  };
  if (def.string !== undefined) {
    const s = requireObject(parsed, def.string, [...path, 'string']);
    checkUnknownKeys(parsed, s, ['matchType', 'value', 'caseSensitive'], [...path, 'string']);
    const caseSensitive = s.caseSensitive !== undefined ? requireBoolean(parsed, s.caseSensitive, [...path, 'string', 'caseSensitive']) : undefined;
    result.string = {
      matchType: requireEnum(parsed, s.matchType, AUDIENCE_STRING_MATCH_TYPES, [...path, 'string', 'matchType']),
      value: requireString(parsed, s.value, [...path, 'string', 'value']),
      ...(caseSensitive !== undefined ? { caseSensitive } : {}),
    };
  }
  if (def.inList !== undefined) {
    const l = requireObject(parsed, def.inList, [...path, 'inList']);
    checkUnknownKeys(parsed, l, ['values', 'caseSensitive'], [...path, 'inList']);
    const caseSensitive = l.caseSensitive !== undefined ? requireBoolean(parsed, l.caseSensitive, [...path, 'inList', 'caseSensitive']) : undefined;
    result.inList = {
      values: requireStringArray(parsed, l.values, [...path, 'inList', 'values']),
      ...(caseSensitive !== undefined ? { caseSensitive } : {}),
    };
  }
  if (def.numeric !== undefined) {
    const n = requireObject(parsed, def.numeric, [...path, 'numeric']);
    checkUnknownKeys(parsed, n, ['operation', 'value'], [...path, 'numeric']);
    result.numeric = {
      operation: requireEnum(parsed, n.operation, AUDIENCE_NUMERIC_OPERATIONS, [...path, 'numeric', 'operation']),
      value: requireNumber(parsed, n.value, [...path, 'numeric', 'value']),
    };
  }
  if (def.between !== undefined) {
    const b = requireObject(parsed, def.between, [...path, 'between']);
    checkUnknownKeys(parsed, b, ['from', 'to'], [...path, 'between']);
    result.between = {
      from: requireNumber(parsed, b.from, [...path, 'between', 'from']),
      to: requireNumber(parsed, b.to, [...path, 'between', 'to']),
    };
  }
  return result;
}

function validateAudienceEventFilter(parsed: ParsedConfig, raw: unknown, path: string[]): AudienceEventFilterDef {
  const def = requireObject(parsed, raw, path);
  checkUnknownKeys(parsed, def, AUDIENCE_EVENT_FILTER_KEYS, path);
  const eventName = requireString(parsed, def.eventName, [...path, 'eventName']);
  const parameterFilter =
    def.parameterFilter !== undefined
      ? validateAudienceFilterExpression(parsed, def.parameterFilter, [...path, 'parameterFilter'])
      : undefined;
  return { eventName, ...(parameterFilter !== undefined ? { parameterFilter } : {}) };
}

function validateEnhancedMeasurement(parsed: ParsedConfig, raw: unknown, path: string[]): EnhancedMeasurementDef {
  const def = requireObject(parsed, raw, path);
  checkUnknownKeys(parsed, def, ENHANCED_MEASUREMENT_KEYS, path);
  const result: EnhancedMeasurementDef = {};
  for (const key of ENHANCED_MEASUREMENT_KEYS) {
    if (def[key] !== undefined) (result as Record<string, boolean>)[key] = requireBoolean(parsed, def[key], [...path, key]);
  }
  return result;
}

function validateDimensions(
  parsed: ParsedConfig,
  raw: unknown,
  path: string[],
): Record<string, DimensionDef> {
  const container = requireObject(parsed, raw, path);
  const result: Record<string, DimensionDef> = {};
  for (const [name, value] of Object.entries(container)) {
    const itemPath = [...path, name];
    const def = requireObject(parsed, value, itemPath);
    checkUnknownKeys(parsed, def, DIMENSION_KEYS, itemPath);
    const scope = requireEnum(parsed, def.scope, SCOPES, [...itemPath, 'scope']);
    const parameter = requireString(parsed, def.parameter, [...itemPath, 'parameter']);
    const isProtected = def.protected !== undefined ? requireBoolean(parsed, def.protected, [...itemPath, 'protected']) : undefined;
    result[name] = { scope, parameter, ...(isProtected !== undefined ? { protected: isProtected } : {}) };
  }
  return result;
}

function validateMetrics(
  parsed: ParsedConfig,
  raw: unknown,
  path: string[],
): Record<string, MetricDef> {
  const container = requireObject(parsed, raw, path);
  const result: Record<string, MetricDef> = {};
  for (const [name, value] of Object.entries(container)) {
    const itemPath = [...path, name];
    const def = requireObject(parsed, value, itemPath);
    checkUnknownKeys(parsed, def, METRIC_KEYS, itemPath);
    const scope = requireEnum(parsed, def.scope, SCOPES, [...itemPath, 'scope']);
    const parameter = requireString(parsed, def.parameter, [...itemPath, 'parameter']);
    const measurementUnit =
      def.measurementUnit !== undefined
        ? requireString(parsed, def.measurementUnit, [...itemPath, 'measurementUnit'])
        : undefined;
    const isProtected = def.protected !== undefined ? requireBoolean(parsed, def.protected, [...itemPath, 'protected']) : undefined;
    result[name] = { scope, parameter, measurementUnit, ...(isProtected !== undefined ? { protected: isProtected } : {}) };
  }
  return result;
}

// `setupTags`/`teardownTags` can cycle (tag A sets up B, B sets up A); that is caught by
// `buildDependencyGraph`'s topological sort (`CircularDependencyError`), not here.
// Tag types that load a Google measurement/advertising script, so they need an explicit consent
// call before firing. Other tag types (customHtml, customImage, ...) are too generic to guess at.
const TAG_TYPES_THAT_NEED_CONSENT = ['ga4Event', 'googleTag'] as const;

function checkConsentLint(parsed: ParsedConfig, gtm: AnalyticsConfig['gtm']): void {
  for (const [name, tag] of Object.entries(gtm.tags)) {
    if (!(TAG_TYPES_THAT_NEED_CONSENT as readonly string[]).includes(tag.type)) continue;
    if (tag.consent === undefined) {
      fail(parsed, ['gtm', 'tags', name], [
        { label: 'Missing consent', value: `a "${tag.type}" tag needs a \`consent\` block` },
        { label: 'Fix', value: 'declare `consent: {status: needed, types: [...]}`, or `consent: {status: notNeeded}` to waive it explicitly' },
      ]);
    }
  }
}

// Substrings of GA4 event/user parameter names that suggest personal data. GA4 forbids sending
// PII in event parameters and responds by deleting the offending data, not just warning about it.
const PII_NAME_PATTERNS = [
  'email',
  'phone',
  'address',
  'street',
  'zip',
  'postal',
  'ssn',
  'social_security',
  'passport',
  'credit_card',
  'card_number',
  'cvv',
  'password',
  'first_name',
  'last_name',
  'full_name',
  'birth',
  'national_id',
  'tax_id',
  'ip_address',
];

function checkPiiLint(parsed: ParsedConfig, events: Record<string, EventDef>): void {
  for (const [eventName, event] of Object.entries(events)) {
    for (const paramName of Object.keys(event.parameters)) {
      const normalized = paramName.toLowerCase();
      const match = PII_NAME_PATTERNS.find((pattern) => normalized.includes(pattern));
      if (match) {
        fail(parsed, ['events', eventName, 'parameters', paramName], [
          { label: 'Parameter name suggests personal data', value: paramName },
          { label: 'Matched pattern', value: match },
          { label: 'Fix', value: 'rename it, or drop it: GA4 deletes event data that carries PII rather than just rejecting it' },
        ]);
      }
    }
  }
}

// GA4 naming/limit rules, verified against support.google.com/analytics/answer/13316687
// (2026-08-28): names start with a letter and contain only letters, digits, underscores;
// event and parameter names cap at 40 characters; an event carries at most 25 parameters;
// a property carries at most 50 event-scoped custom dimensions (checked in `compile.ts`,
// where event-derived and hand-written dimensions are merged).
const GA4_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const GA4_NAME_MAX_LENGTH = 40;
const GA4_MAX_PARAMETERS_PER_EVENT = 25;

// Automatically-collected event names GA4 refuses to accept as custom event names.
const GA4_RESERVED_EVENT_NAMES = [
  'ad_impression',
  'app_remove',
  'app_store_refund',
  'app_store_subscription_cancel',
  'app_store_subscription_renew',
  'click',
  'error',
  'file_download',
  'first_open',
  'first_visit',
  'form_start',
  'form_submit',
  'in_app_purchase',
  'page_view',
  'scroll',
  'session_start',
  'user_engagement',
  'view_complete',
  'video_progress',
  'video_start',
  'view_search_results',
  'ad_activeview',
  'ad_click',
  'ad_exposure',
  'app_exception',
  'app_install',
  'app_update',
  'firebase_campaign',
  'os_update',
];
const GA4_RESERVED_EVENT_PREFIXES = ['dynamic_link_', 'notification_'];

// GA4 parameter names cannot start with these, and these exact names are reserved for GA4 itself.
const GA4_RESERVED_PARAMETER_PREFIXES = ['_', 'firebase_', 'ga_', 'google_', 'gtag.'];
const GA4_RESERVED_PARAMETER_NAMES = ['cid', 'customer_id', 'dclid', 'gclid', 'query_id', 'session_id', 'uid', 'user_id'];
// `currency` is reserved only for custom dimension/metric creation (support.google.com/analytics/answer/13316687);
// GA4's own recommended ecommerce events require it as a standard parameter, so it's only blocked with `dimension: true`.
const GA4_DIMENSION_RESERVED_PARAMETER_NAMES = [...GA4_RESERVED_PARAMETER_NAMES, 'currency'];

function checkGa4NamingLint(parsed: ParsedConfig, events: Record<string, EventDef>): void {
  for (const [eventName, event] of Object.entries(events)) {
    const eventPath = ['events', eventName];
    if (!GA4_NAME_PATTERN.test(eventName)) {
      fail(parsed, eventPath, [
        { label: 'Invalid GA4 event name', value: eventName },
        { label: 'Fix', value: 'start with a letter, use only letters, digits and underscores' },
      ]);
    }
    if (eventName.length > GA4_NAME_MAX_LENGTH) {
      fail(parsed, eventPath, [
        { label: 'GA4 event name too long', value: `${eventName} (${eventName.length} chars)` },
        { label: 'Limit', value: `${GA4_NAME_MAX_LENGTH} characters` },
      ]);
    }
    if (
      GA4_RESERVED_EVENT_NAMES.includes(eventName) ||
      GA4_RESERVED_EVENT_PREFIXES.some((prefix) => eventName.startsWith(prefix))
    ) {
      fail(parsed, eventPath, [
        { label: 'Reserved GA4 event name', value: eventName },
        { label: 'Fix', value: 'this name is automatically collected by GA4; pick a different name for a custom event' },
      ]);
    }

    const parameterNames = Object.keys(event.parameters);
    if (parameterNames.length > GA4_MAX_PARAMETERS_PER_EVENT) {
      fail(parsed, [...eventPath, 'parameters'], [
        { label: 'Too many parameters', value: `${parameterNames.length} declared` },
        { label: 'Limit', value: `${GA4_MAX_PARAMETERS_PER_EVENT} parameters per event` },
      ]);
    }

    for (const paramName of parameterNames) {
      const paramPath = [...eventPath, 'parameters', paramName];
      if (!GA4_NAME_PATTERN.test(paramName)) {
        fail(parsed, paramPath, [
          { label: 'Invalid GA4 parameter name', value: paramName },
          { label: 'Fix', value: 'start with a letter, use only letters, digits and underscores' },
        ]);
      }
      if (paramName.length > GA4_NAME_MAX_LENGTH) {
        fail(parsed, paramPath, [
          { label: 'GA4 parameter name too long', value: `${paramName} (${paramName.length} chars)` },
          { label: 'Limit', value: `${GA4_NAME_MAX_LENGTH} characters` },
        ]);
      }
      const reservedNames = event.parameters[paramName]?.dimension
        ? GA4_DIMENSION_RESERVED_PARAMETER_NAMES
        : GA4_RESERVED_PARAMETER_NAMES;
      if (
        reservedNames.includes(paramName) ||
        GA4_RESERVED_PARAMETER_PREFIXES.some((prefix) => paramName.startsWith(prefix))
      ) {
        fail(parsed, paramPath, [
          { label: 'Reserved GA4 parameter name', value: paramName },
          { label: 'Fix', value: 'GA4 reserves this name (or prefix) for its own use; pick a different parameter name' },
        ]);
      }
    }
  }
}

function checkCrossReferences(
  parsed: ParsedConfig,
  gtm: AnalyticsConfig['gtm'],
  ga4: AnalyticsConfig['ga4'],
): void {
  const seen = new Map<string, string>();
  const record = (id: string, where: string, path: string[]) => {
    const existing = seen.get(id);
    if (existing) {
      fail(parsed, path, [
        { label: 'Duplicate resource id', value: id },
        { label: 'Also defined at', value: existing },
      ]);
    }
    seen.set(id, where);
  };

  for (const name of Object.keys(gtm.variables)) record(name, `gtm.variables.${name}`, ['gtm', 'variables', name]);
  for (const name of Object.keys(gtm.triggers)) record(name, `gtm.triggers.${name}`, ['gtm', 'triggers', name]);
  for (const name of Object.keys(gtm.tags)) record(name, `gtm.tags.${name}`, ['gtm', 'tags', name]);
  for (const name of Object.keys(gtm.folders)) record(name, `gtm.folders.${name}`, ['gtm', 'folders', name]);
  for (const name of Object.keys(ga4.dimensions)) record(name, `ga4.dimensions.${name}`, ['ga4', 'dimensions', name]);
  for (const name of Object.keys(ga4.metrics)) record(name, `ga4.metrics.${name}`, ['ga4', 'metrics', name]);

  for (const [name, tag] of Object.entries(gtm.tags)) {
    for (const field of ['trigger', 'exceptTrigger'] as const) {
      for (const triggerName of tag[field] ?? []) {
        if (!gtm.triggers[triggerName] && !BUILT_IN_TRIGGERS[triggerName]) {
          const suggestion = closestMatch(triggerName, [...Object.keys(gtm.triggers), ...BUILT_IN_TRIGGER_NAMES]);
          const body = [{ label: 'Unknown trigger', value: triggerName }];
          if (suggestion) body.push({ label: 'Did you mean', value: suggestion });
          fail(parsed, ['gtm', 'tags', name, field], body);
        }
      }
    }
  }

  for (const [name, tag] of Object.entries(gtm.tags)) {
    for (const field of ['setupTags', 'teardownTags'] as const) {
      for (const tagName of tag[field] ?? []) {
        if (tagName === name) {
          fail(parsed, ['gtm', 'tags', name, field], [{ label: 'A tag cannot reference itself', value: tagName }]);
        }
        if (!gtm.tags[tagName]) {
          const suggestion = closestMatch(tagName, Object.keys(gtm.tags));
          const body = [{ label: 'Unknown tag', value: tagName }];
          if (suggestion) body.push({ label: 'Did you mean', value: suggestion });
          fail(parsed, ['gtm', 'tags', name, field], body);
        }
      }
    }
  }

  for (const [section, defs] of [
    ['variables', gtm.variables],
    ['triggers', gtm.triggers],
    ['tags', gtm.tags],
  ] as const) {
    for (const [name, def] of Object.entries(defs)) {
      if (def.folder === undefined) continue;
      if (!(def.folder in gtm.folders)) {
        const suggestion = closestMatch(def.folder, Object.keys(gtm.folders));
        const body = [{ label: 'Unknown folder', value: def.folder }];
        if (suggestion) body.push({ label: 'Did you mean', value: suggestion });
        fail(parsed, ['gtm', section, name, 'folder'], body);
      }
    }
  }
}

function fail(parsed: ParsedConfig, path: string[], body: { label: string; value: string }[]): never {
  throw new ConfigError(locateFile(parsed, path), locateLine(parsed, path), path.join('.'), body);
}

function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
  if (value === undefined) return 'undefined (missing)';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return String(value);
}

function requireObject(parsed: ParsedConfig, value: unknown, path: string[]): Json {
  if (!isPlainObject(value)) {
    fail(parsed, path, [
      { label: 'Expected', value: 'object' },
      { label: 'Received', value: describeType(value) },
    ]);
  }
  return value;
}

function requireString(parsed: ParsedConfig, value: unknown, path: string[]): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(parsed, path, [
      { label: 'Expected', value: 'non-empty string' },
      { label: 'Received', value: describeType(value) },
    ]);
  }
  return value;
}

function requireBoolean(parsed: ParsedConfig, value: unknown, path: string[]): boolean {
  if (typeof value !== 'boolean') {
    fail(parsed, path, [
      { label: 'Expected', value: 'boolean' },
      { label: 'Received', value: describeType(value) },
    ]);
  }
  return value;
}

function requireNumber(parsed: ParsedConfig, value: unknown, path: string[]): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    fail(parsed, path, [
      { label: 'Expected', value: 'number' },
      { label: 'Received', value: describeType(value) },
    ]);
  }
  return value;
}

function requireStringArray(parsed: ParsedConfig, value: unknown, path: string[]): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    fail(parsed, path, [
      { label: 'Expected', value: 'array of strings' },
      { label: 'Received', value: describeType(value) },
    ]);
  }
  return value as string[];
}

function requireEnum<T extends string>(
  parsed: ParsedConfig,
  value: unknown,
  allowed: readonly T[],
  path: string[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(parsed, path, [
      { label: 'Expected', value: allowed.join(' | ') },
      { label: 'Received', value: describeType(value) },
    ]);
  }
  return value as T;
}

function checkUnknownKeys(parsed: ParsedConfig, obj: Json, allowed: readonly string[], path: string[]): void {
  for (const key of Object.keys(obj)) {
    if (allowed.includes(key)) continue;
    const suggestion = closestMatch(key, allowed);
    const body = [{ label: 'Unknown property', value: key }];
    if (suggestion) body.push({ label: 'Did you mean', value: suggestion });
    fail(parsed, path, body);
  }
}

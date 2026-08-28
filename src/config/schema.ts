import { ConfigError } from './errors.js';
import { locateLine, type ParsedConfig } from './parser.js';
import { closestMatch } from './suggest.js';
import { BUILT_IN_VARIABLE_NAMES } from '../providers/google/gtm/builtin-variables.js';

export interface EventParameterDef {
  type: 'string' | 'number' | 'boolean';
  dimension?: boolean;
  optional?: boolean;
}

export interface EventDef {
  description?: string;
  keyEvent?: boolean;
  parameters: Record<string, EventParameterDef>;
}

export interface ResourceDef {
  type: string;
  /** Folder name (from `gtm.folders`) this resource is organized under. */
  folder?: string;
  [key: string]: unknown;
}

export interface TagDef extends ResourceDef {
  trigger?: string[];
  /** Trigger names that block this tag from firing (GTM's `blockingTriggerId`). */
  exceptTrigger?: string[];
  /** Tag names that must fire (and succeed) before this tag (GTM's `setupTag`). */
  setupTags?: string[];
  /** Tag names that fire after this tag (GTM's `teardownTag`). */
  teardownTags?: string[];
}

export interface DimensionDef {
  scope: 'event' | 'user';
  parameter: string;
}

export interface MetricDef {
  scope: 'event' | 'user';
  parameter: string;
  measurementUnit?: string;
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
  };
}

type Json = Record<string, unknown>;

const TOP_LEVEL_KEYS = ['version', 'project', 'google', 'events', 'gtm', 'ga4'];
const EVENT_KEYS = ['description', 'keyEvent', 'parameters'];
const PARAMETER_KEYS = ['type', 'dimension', 'optional'];
const PARAMETER_TYPES = ['string', 'number', 'boolean'] as const;
const DIMENSION_KEYS = ['scope', 'parameter'];
const METRIC_KEYS = ['scope', 'parameter', 'measurementUnit'];
const SCOPES = ['event', 'user'] as const;

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
    events[name] = { description, keyEvent, parameters };
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
    result[name] = { ...def, type, folder };
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
    result[name] = { ...def, type, trigger, exceptTrigger, setupTags, teardownTags, folder };
  }
  return result;
}

function validateGa4(parsed: ParsedConfig, raw: unknown): AnalyticsConfig['ga4'] {
  const container = requireObject(parsed, raw, ['ga4']);
  checkUnknownKeys(parsed, container, ['dimensions', 'metrics', 'keyEvents'], ['ga4']);
  return {
    dimensions: validateDimensions(parsed, container.dimensions ?? {}, ['ga4', 'dimensions']),
    metrics: validateMetrics(parsed, container.metrics ?? {}, ['ga4', 'metrics']),
    keyEvents: requireObject(parsed, container.keyEvents ?? {}, ['ga4', 'keyEvents']),
  };
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
    result[name] = { scope, parameter };
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
    result[name] = { scope, parameter, measurementUnit };
  }
  return result;
}

// `setupTags`/`teardownTags` can cycle (tag A sets up B, B sets up A); that is caught by
// `buildDependencyGraph`'s topological sort (`CircularDependencyError`), not here.
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
        if (!gtm.triggers[triggerName]) {
          const suggestion = closestMatch(triggerName, Object.keys(gtm.triggers));
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
  throw new ConfigError(parsed.file, locateLine(parsed, path), path.join('.'), body);
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

function checkUnknownKeys(parsed: ParsedConfig, obj: Json, allowed: string[], path: string[]): void {
  for (const key of Object.keys(obj)) {
    if (allowed.includes(key)) continue;
    const suggestion = closestMatch(key, allowed);
    const body = [{ label: 'Unknown property', value: key }];
    if (suggestion) body.push({ label: 'Did you mean', value: suggestion });
    fail(parsed, path, body);
  }
}

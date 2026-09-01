import { join } from 'node:path';
import { loadConfig } from '../../config/loader.js';
import { interpolateConfig } from '../../config/interpolation.js';
import { validateConfig } from '../../config/schema.js';
import { compileEvents, toResources } from '../../core/compile.js';
import { diff, deepEqual } from '../../core/diff.js';
import type { Change, Resource } from '../../core/resource.js';
import { readState } from '../../core/state.js';
import { authorize, SCOPES } from '../../providers/google/auth/index.js';
import { GtmClient, resolveWorkspaceId, gtmIdField, type GtmKind, type GtmObject } from '../../providers/google/gtm/client.js';
import { fromGtmPayload } from '../../providers/google/gtm/mapping.js';
import { BUILT_IN_VARIABLES } from '../../providers/google/gtm/builtin-variables.js';
import { Ga4Client, type Ga4Kind, type Ga4Object } from '../../providers/google/ga4/client.js';
import { diffGa4Settings, hasGa4SettingsChanges, resolveGa4Stream, type Ga4SettingsDiff } from '../../providers/google/ga4/settings.js';
import { fromGa4Payload } from '../../providers/google/ga4/mapping.js';
import { printFailure } from '../failure.js';
import type { GlobalOptions } from '../options.js';
import type { AnalyticsConfig } from '../../config/schema.js';

const GTM_KINDS: GtmKind[] = ['folder', 'variable', 'trigger', 'tag'];
const GA4_KINDS: Ga4Kind[] = [
  'dimension',
  'metric',
  'keyEvent',
  'audience',
  'eventCreateRule',
  'eventEditRule',
  'calculatedMetric',
  'channelGroup',
  'measurementProtocolSecret',
];
/** Stream-scoped GA4 kinds need a resolved data stream `name` passed to `listManaged`. */
const GA4_STREAM_SCOPED_KINDS: ReadonlySet<Ga4Kind> = new Set(['eventCreateRule', 'eventEditRule', 'measurementProtocolSecret']);

const KIND_LABEL: Record<string, string> = {
  'gtm.folder': 'folder',
  'gtm.variable': 'variable',
  'gtm.trigger': 'trigger',
  'gtm.tag': 'tag',
  'ga4.dimension': 'custom dimension',
  'ga4.metric': 'custom metric',
  'ga4.keyEvent': 'key event',
  'ga4.audience': 'audience',
  'ga4.eventCreateRule': 'event create rule',
  'ga4.eventEditRule': 'event edit rule',
  'ga4.calculatedMetric': 'calculated metric',
  'ga4.channelGroup': 'channel group',
  'ga4.measurementProtocolSecret': 'measurement protocol secret',
};

export interface PlanResult {
  changes: Change[];
  counts: { create: number; update: number; delete: number };
  config: AnalyticsConfig;
  compiled: AnalyticsConfig;
  gtm: GtmClient;
  ga4: Ga4Client;
  statePath: string;
  /** `${kind}:${logicalId}` -> GTM's own numeric id, for update/delete. */
  gtmIds: Record<string, string>;
  /** `${kind}:${logicalId}` -> GA4's full resource `name`, for update/delete. */
  ga4Names: Record<string, string>;
  triggerGtmIdToLogicalId: Record<string, string>;
  folderGtmIdToLogicalId: Record<string, string>;
  /** Built-in variables declared in config but not yet enabled remotely. Additive only — never disabled by `apply`. */
  builtInVariablesToEnable: string[];
  /** GA4 property/stream settings (retention, Google Signals, enhanced measurement) that differ from live state. */
  ga4Settings: Ga4SettingsDiff;
  /** `google.ga4.measurementId` if set, else derived from the resolved web stream (PRD gap closed 2026-08-30). */
  measurementId: string | undefined;
}

/** Read-only by design: `*Readonly` scopes and `listManaged` only, never create/update/delete. */
export async function plan(opts: GlobalOptions): Promise<void> {
  try {
    const result = await computePlan(opts, [SCOPES.gtmReadonly, SCOPES.ga4Readonly]);
    render(result, opts.format);
    if (result.changes.length > 0 || result.builtInVariablesToEnable.length > 0 || hasGa4SettingsChanges(result.ga4Settings)) {
      process.exitCode = 2;
    }
  } catch (error) {
    printFailure(error);
    process.exitCode = 1;
  }
}

/** `apply` passes edit scopes so it can reuse these clients without a second `authorize()`. */
export async function computePlan(opts: GlobalOptions, scopes: string[]): Promise<PlanResult> {
  const parsed = loadConfig(opts.config);
  const interpolated = { ...parsed, data: interpolateConfig(parsed) };
  const config = validateConfig(interpolated);

  const auth = await authorize(scopes);
  const ga4 = new Ga4Client(auth, config.google.ga4.propertyId);

  // Resolved once, up front: `compileEvents` needs the stream's `measurementId` when config doesn't
  // declare one, and `diffGa4Settings`/stream-scoped `listManaged` calls below reuse the same lookup.
  const resolvedStream = config.ga4.streamWebsiteUrl ? await resolveGa4Stream(ga4, config.ga4.streamWebsiteUrl) : undefined;
  const derivedMeasurementId = config.google.ga4.measurementId ?? resolvedStream?.webStreamData?.measurementId;
  const compiled = compileEvents(config, parsed.file, { measurementId: derivedMeasurementId });

  const workspaceId = await resolveWorkspaceId(
    auth,
    config.google.gtm.accountId,
    config.google.gtm.containerId,
    config.google.gtm.workspace,
  );
  const gtm = new GtmClient(auth, { accountId: config.google.gtm.accountId, containerId: config.google.gtm.containerId, workspaceId });
  const statePath = join(process.cwd(), '.analytics', 'state.json');
  const state = await readState(statePath);

  const remote: Resource[] = [];
  const gtmIds: Record<string, string> = {};
  const ga4Names: Record<string, string> = {};

  const [managedFolders, managedTriggers] = await Promise.all([gtm.listManaged('folder'), gtm.listManaged('trigger')]);
  const folderGtmIdToLogicalId: Record<string, string> = {};
  for (const resource of managedFolders) {
    const gtmId = (resource.desiredState as GtmObject).folderId;
    if (typeof gtmId === 'string') folderGtmIdToLogicalId[gtmId] = resource.id;
  }
  const triggerGtmIdToLogicalId: Record<string, string> = {};
  for (const resource of managedTriggers) {
    const gtmId = (resource.desiredState as GtmObject).triggerId;
    if (typeof gtmId === 'string') triggerGtmIdToLogicalId[gtmId] = resource.id;
  }

  // Folders and triggers had to be read first — reverse mapping needs them — but nothing
  // below depends on anything else here, so the remaining listings go out together.
  const [gtmManaged, ga4Managed, enabledBuiltInVariables, ga4Settings] = await Promise.all([
    Promise.all(
      GTM_KINDS.map(async (kind) => ({
        kind,
        resources: kind === 'folder' ? managedFolders : kind === 'trigger' ? managedTriggers : await gtm.listManaged(kind),
      })),
    ),
    Promise.all(
      GA4_KINDS.map(async (kind) => ({
        kind,
        resources: GA4_STREAM_SCOPED_KINDS.has(kind) && !resolvedStream ? [] : await ga4.listManaged(kind, state, resolvedStream?.name),
      })),
    ),
    gtm.listEnabledBuiltInVariables(),
    diffGa4Settings(ga4, config.ga4, resolvedStream),
  ]);

  const builtInVariablesToEnable = config.gtm.builtInVariables
    .map((name) => BUILT_IN_VARIABLES[name])
    .filter((type) => !enabledBuiltInVariables.includes(type));

  for (const { kind, resources: managed } of gtmManaged) {
    for (const resource of managed) {
      const object = resource.desiredState as GtmObject;
      const gtmId = object[gtmIdField(kind)];
      if (typeof gtmId === 'string') gtmIds[`${kind}:${resource.id}`] = gtmId;
      const desiredState = fromGtmPayload(kind, object, { triggerGtmIdToLogicalId, folderGtmIdToLogicalId });
      if (object.__protected) desiredState.protected = true;
      remote.push({ ...resource, desiredState });
    }
  }

  // Collected here rather than carried on `desiredState`: it is a property of the live object, not
  // of the config, and anything on `desiredState` would show up as a diff.
  const undeletableKeyEvents = new Set<string>();

  for (const { kind, resources: managed } of ga4Managed) {
    for (const resource of managed) {
      const object = resource.desiredState as Ga4Object;
      if (object.name) ga4Names[`${kind}:${resource.id}`] = object.name;
      if (kind === 'keyEvent' && object.deletable === false) undeletableKeyEvents.add(resource.id);
      const desiredState = fromGa4Payload(kind, object);
      if (object.__protected) desiredState.protected = true;
      remote.push({ ...resource, desiredState });
    }
  }

  const desired = toResources(compiled);
  const changes = diff(desired, remote);
  checkAudienceImmutableFields(changes);
  checkUndeletableKeyEvents(changes, undeletableKeyEvents);

  const counts = { create: 0, update: 0, delete: 0 };
  for (const change of changes) counts[change.operation]++;

  return {
    changes,
    counts,
    config,
    compiled,
    gtm,
    ga4,
    statePath,
    gtmIds,
    ga4Names,
    triggerGtmIdToLogicalId,
    folderGtmIdToLogicalId,
    builtInVariablesToEnable,
    ga4Settings,
    measurementId: derivedMeasurementId,
  };
}

/**
 * `membershipDurationDays`/`exclusionDurationMode`/`filterClauses` are immutable on GA4's Audience
 * resource once created (confirmed via GA4's own API reference); `apply` can only PATCH
 * `displayName`/`description`. Left unchecked, editing a filter would plan an "update", apply would
 * silently PATCH nothing that matters, and `drift` would flag it forever. Fail here instead, naming
 * the field, so the fix is obvious: rename the audience (a new config key creates a new audience).
 */
const AUDIENCE_IMMUTABLE_FIELDS = ['membershipDurationDays', 'exclusionDurationMode', 'filterClauses'] as const;

export function checkAudienceImmutableFields(changes: Change[]): void {
  for (const change of changes) {
    if (change.operation !== 'update' || change.after.type !== 'ga4.audience') continue;
    const before = change.before.desiredState as Record<string, unknown>;
    const after = change.after.desiredState as Record<string, unknown>;
    const changedFields = AUDIENCE_IMMUTABLE_FIELDS.filter((field) => !deepEqual(before[field], after[field]));
    if (changedFields.length > 0) {
      throw new Error(
        `ga4.audiences.${change.after.id} changes ${changedFields.join(', ')}, which GA4 does not allow updating on an ` +
          'existing audience. Rename this audience (a new config key creates a new one) if you want the new definition, ' +
          'or revert the change if it was accidental.',
      );
    }
  }
}

/**
 * GA4 only deletes key events it reports as `deletable`. A property comes with default key events on
 * recommended events (`purchase` among them), and `keyEvents.delete` on one of those answers
 * `INVALID_ARGUMENT`. Left unchecked, dropping such an entry from config plans a `- delete` that
 * fails mid-`apply`, every time, with an error naming the API rather than the config key. Fail here
 * instead, the same way an immutable audience field does.
 */
export function checkUndeletableKeyEvents(changes: Change[], undeletable: ReadonlySet<string>): void {
  for (const change of changes) {
    if (change.operation !== 'delete' || change.resource.type !== 'ga4.keyEvent') continue;
    if (!undeletable.has(change.resource.id)) continue;
    throw new Error(
      `ga4.keyEvents.${change.resource.id} is a key event GA4 reports as not deletable, which is how it marks the ` +
        'default key events it creates on a property. The Admin API only deletes custom ones, so this delete would ' +
        `fail. Leave ${change.resource.id} declared in config (it costs nothing if the event never fires), or unmark ` +
        'it as a key event in the GA4 UI first, which removes it from live state and makes the config change a no-op.',
    );
  }
}

function render(result: PlanResult, format: GlobalOptions['format']): void {
  if (format === 'json') return renderJson(result);
  if (format === 'markdown') return renderMarkdown(result);
  renderText(result);
}

export interface PlanJson {
  hasChanges: boolean;
  counts: PlanResult['counts'];
  changes: Array<{ operation: Change['operation']; type: string; id: string }>;
  builtInVariablesToEnable?: string[];
  ga4Settings?: Ga4SettingsDiff;
}

/** Only the fields these renderers need — lets `diff`/`drift` reuse them without a full `PlanResult`. */
export interface ChangeSummary {
  changes: Change[];
  counts: PlanResult['counts'];
}

/** The stable output contract the GitHub Action reads: `hasChanges`, per-operation counts, and the change list. */
export function buildPlanJson({ changes, counts }: ChangeSummary): PlanJson {
  return {
    hasChanges: changes.length > 0,
    counts,
    changes: changes.map((change) => {
      const resource = resourceOf(change);
      return { operation: change.operation, type: resource.type, id: resource.id };
    }),
  };
}

/** A PR-comment-ready summary: a counts line and a table, one row per change. */
export function buildPlanMarkdown({ changes, counts }: ChangeSummary): string {
  if (changes.length === 0) return '**GTM as Code**: no changes.';

  const lines = [
    '**GTM as Code plan**',
    '',
    `${counts.create} to create, ${counts.update} to update, ${counts.delete} to delete`,
    '',
    '| Action | Kind | Id |',
    '| --- | --- | --- |',
  ];
  for (const change of changes) {
    const resource = resourceOf(change);
    const symbol = { create: '+', update: '~', delete: '-' }[change.operation];
    lines.push(`| ${symbol} ${change.operation} | ${KIND_LABEL[resource.type] ?? resource.type} | \`${resource.id}\` |`);
  }
  return lines.join('\n');
}

function renderJson(result: PlanResult): void {
  console.log(JSON.stringify(planJsonWithBuiltIns(result), null, 2));
}

function renderMarkdown(result: PlanResult): void {
  console.log(planMarkdownWithBuiltIns(result));
}

/** `buildPlanJson`/`buildPlanMarkdown` only know `ChangeSummary` — this adds the built-in-variable
 *  gap on top, shared by `plan` and `drift`, the two commands that fetch it via `computePlan`. */
export function planJsonWithBuiltIns(result: PlanResult): PlanJson {
  const json = buildPlanJson(result);
  if (result.builtInVariablesToEnable.length > 0) json.builtInVariablesToEnable = builtInVariableNames(result.builtInVariablesToEnable);
  if (hasGa4SettingsChanges(result.ga4Settings)) json.ga4Settings = result.ga4Settings;
  return json;
}

export function planMarkdownWithBuiltIns(result: PlanResult): string {
  const lines = [buildPlanMarkdown(result)];
  if (result.builtInVariablesToEnable.length > 0) {
    lines.push('', `Built-in variables to enable: ${builtInVariableNames(result.builtInVariablesToEnable).join(', ')}`);
  }
  if (hasGa4SettingsChanges(result.ga4Settings)) {
    lines.push('', `GA4 settings to update: ${describeGa4SettingsChanges(result.ga4Settings).join(', ')}`);
  }
  return lines.join('\n');
}

export function describeGa4SettingsChanges(diff: Ga4SettingsDiff): string[] {
  const changes: string[] = [];
  if (diff.dataRetention) changes.push(`dataRetention → ${diff.dataRetention.patch.eventDataRetention}`);
  if (diff.googleSignals) changes.push(`googleSignals → ${diff.googleSignals.patch.state}`);
  if (diff.attributionSettings) changes.push(`attributionSettings.{${diff.attributionSettings.updateMask.join(', ')}}`);
  if (diff.enhancedMeasurement) changes.push(`enhancedMeasurement.{${diff.enhancedMeasurement.updateMask.join(', ')}}`);
  return changes;
}

export function builtInVariableNames(types: string[]): string[] {
  const byType = Object.fromEntries(Object.entries(BUILT_IN_VARIABLES).map(([name, type]) => [type, name]));
  return types.map((type) => byType[type] ?? type);
}

function renderText({ changes, counts, builtInVariablesToEnable, ga4Settings }: PlanResult): void {
  console.log('GTM as Code\n');

  for (const { header, prefix, showAction } of [
    { header: 'Google Tag Manager', prefix: 'gtm.', showAction: true },
    { header: 'Google Analytics 4', prefix: 'ga4.', showAction: false },
  ]) {
    const section = changes.filter((change) => resourceOf(change).type.startsWith(prefix));
    if (section.length === 0) continue;

    console.log(`${header}\n`);
    for (const change of section.filter((c) => c.operation === 'create')) printLine('+', 'create', change, showAction);
    for (const change of section.filter((c) => c.operation === 'update')) {
      printLine('~', 'update', change, showAction);
      if (change.operation === 'update') printFieldDiff(change.before.desiredState, change.after.desiredState);
    }
    for (const change of section.filter((c) => c.operation === 'delete')) printLine('-', 'delete', change, showAction);
    console.log('');
  }

  if (builtInVariablesToEnable.length > 0) {
    console.log('Built-in variables\n');
    for (const name of builtInVariableNames(builtInVariablesToEnable)) console.log(`+ enable            ${name}`);
    console.log('');
  }

  if (hasGa4SettingsChanges(ga4Settings)) {
    console.log('GA4 settings\n');
    for (const line of describeGa4SettingsChanges(ga4Settings)) console.log(`~ update            ${line}`);
    console.log('');
  }

  console.log('Plan:');
  console.log(`  ${counts.create} to create`);
  console.log(`  ${counts.update} to update`);
  console.log(`  ${counts.delete} to delete`);
}

function resourceOf(change: Change): Resource {
  return change.operation === 'update' ? change.after : change.resource;
}

function printLine(symbol: string, action: string, change: Change, showAction: boolean): void {
  const resource = resourceOf(change);
  const kind = KIND_LABEL[resource.type] ?? resource.type;
  const label = showAction ? `${symbol} ${action} ${kind}` : `${symbol} ${kind}`;
  console.log((label.length >= 20 ? `${label} ` : label.padEnd(20)) + resource.id);
}

function printFieldDiff(before: unknown, after: unknown): void {
  const beforeObj = (before ?? {}) as Record<string, unknown>;
  const afterObj = (after ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
  for (const key of keys) {
    const beforeValue = beforeObj[key];
    const afterValue = afterObj[key];
    if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue;
    console.log(`    ${key}: ${describe(beforeValue)} → ${describe(afterValue)}`);
  }
}

function describe(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

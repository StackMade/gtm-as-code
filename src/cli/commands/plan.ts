import { join } from 'node:path';
import { loadConfig } from '../../config/loader.js';
import { interpolateConfig } from '../../config/interpolation.js';
import { validateConfig } from '../../config/schema.js';
import { compileEvents, toResources } from '../../core/compile.js';
import { diff } from '../../core/diff.js';
import type { Change, Resource } from '../../core/resource.js';
import { readState } from '../../core/state.js';
import { authorize, SCOPES } from '../../providers/google/auth/index.js';
import { GtmClient, resolveWorkspaceId, gtmIdField, type GtmKind, type GtmObject } from '../../providers/google/gtm/client.js';
import { fromGtmPayload } from '../../providers/google/gtm/mapping.js';
import { Ga4Client, type Ga4Kind, type Ga4Object } from '../../providers/google/ga4/client.js';
import { fromGa4Payload } from '../../providers/google/ga4/mapping.js';
import { printFailure } from '../failure.js';
import type { GlobalOptions } from '../options.js';
import type { AnalyticsConfig } from '../../config/schema.js';

const GTM_KINDS: GtmKind[] = ['variable', 'trigger', 'tag'];
const GA4_KINDS: Ga4Kind[] = ['dimension', 'metric', 'keyEvent'];

const KIND_LABEL: Record<string, string> = {
  'gtm.variable': 'variable',
  'gtm.trigger': 'trigger',
  'gtm.tag': 'tag',
  'ga4.dimension': 'custom dimension',
  'ga4.metric': 'custom metric',
  'ga4.keyEvent': 'key event',
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
}

/** Read-only by design: `*Readonly` scopes and `listManaged` only, never create/update/delete. */
export async function plan(opts: GlobalOptions): Promise<void> {
  try {
    const result = await computePlan(opts, [SCOPES.gtmReadonly, SCOPES.ga4Readonly]);
    render(result, opts.format);
    if (result.changes.length > 0) process.exitCode = 2;
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
  const compiled = compileEvents(config, parsed.file);

  const auth = await authorize(scopes);

  const workspaceId = await resolveWorkspaceId(
    auth,
    config.google.gtm.accountId,
    config.google.gtm.containerId,
    config.google.gtm.workspace,
  );
  const gtm = new GtmClient(auth, { accountId: config.google.gtm.accountId, containerId: config.google.gtm.containerId, workspaceId });
  const ga4 = new Ga4Client(auth, config.google.ga4.propertyId);
  const statePath = join(process.cwd(), '.analytics', 'state.json');
  const state = await readState(statePath);

  const remote: Resource[] = [];
  const gtmIds: Record<string, string> = {};
  const ga4Names: Record<string, string> = {};

  const managedTriggers = await gtm.listManaged('trigger');
  const triggerGtmIdToLogicalId: Record<string, string> = {};
  for (const resource of managedTriggers) {
    const gtmId = (resource.desiredState as GtmObject).triggerId;
    if (typeof gtmId === 'string') triggerGtmIdToLogicalId[gtmId] = resource.id;
  }

  // Triggers had to be read first — reverse trigger mapping needs them — but nothing
  // below depends on anything else here, so the remaining listings go out together.
  const [gtmManaged, ga4Managed] = await Promise.all([
    Promise.all(
      GTM_KINDS.map(async (kind) => ({
        kind,
        resources: kind === 'trigger' ? managedTriggers : await gtm.listManaged(kind),
      })),
    ),
    Promise.all(GA4_KINDS.map(async (kind) => ({ kind, resources: await ga4.listManaged(kind, state) }))),
  ]);

  for (const { kind, resources: managed } of gtmManaged) {
    for (const resource of managed) {
      const object = resource.desiredState as GtmObject;
      const gtmId = object[gtmIdField(kind)];
      if (typeof gtmId === 'string') gtmIds[`${kind}:${resource.id}`] = gtmId;
      const desiredState = fromGtmPayload(kind, object, { triggerGtmIdToLogicalId });
      remote.push({ ...resource, desiredState });
    }
  }

  for (const { kind, resources: managed } of ga4Managed) {
    for (const resource of managed) {
      const object = resource.desiredState as Ga4Object;
      if (object.name) ga4Names[`${kind}:${resource.id}`] = object.name;
      remote.push({ ...resource, desiredState: fromGa4Payload(kind, object) });
    }
  }

  const desired = toResources(compiled);
  const changes = diff(desired, remote);

  const counts = { create: 0, update: 0, delete: 0 };
  for (const change of changes) counts[change.operation]++;

  return { changes, counts, config, compiled, gtm, ga4, statePath, gtmIds, ga4Names, triggerGtmIdToLogicalId };
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
}

/** The stable output contract the GitHub Action reads: `hasChanges`, per-operation counts, and the change list. */
export function buildPlanJson({ changes, counts }: PlanResult): PlanJson {
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
export function buildPlanMarkdown({ changes, counts }: PlanResult): string {
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
  console.log(JSON.stringify(buildPlanJson(result), null, 2));
}

function renderMarkdown(result: PlanResult): void {
  console.log(buildPlanMarkdown(result));
}

function renderText({ changes, counts }: PlanResult): void {
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
  console.log(label.padEnd(20) + resource.id);
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

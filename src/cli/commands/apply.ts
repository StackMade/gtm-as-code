import { computePlan, describeGa4SettingsChanges, type PlanResult } from './plan.js';
import { confirm } from '../confirm.js';
import { buildDependencyGraph } from '../../core/graph.js';
import { writeState, recordManaged, forgetManaged, setProtected, readState } from '../../core/state.js';
import { withStateLock } from '../../core/lock.js';
import type { Change, Resource } from '../../core/resource.js';
import { SCOPES } from '../../providers/google/auth/index.js';
import { toGtmPayload } from '../../providers/google/gtm/mapping.js';
import type { GtmKind } from '../../providers/google/gtm/client.js';
import { gtmIdField } from '../../providers/google/gtm/client.js';
import { toGa4Payload } from '../../providers/google/ga4/mapping.js';
import type { Ga4Kind } from '../../providers/google/ga4/client.js';
import { hasGa4SettingsChanges } from '../../providers/google/ga4/settings.js';
import { WorkspaceConflictError } from '../../providers/google/gtm/errors.js';
import { printFailure } from '../failure.js';
import type { GlobalOptions } from '../options.js';

const GTM_KIND_ORDER: GtmKind[] = ['folder', 'variable', 'trigger', 'tag'];
const GA4_UPDATE_MASK: Record<Ga4Kind, string[]> = {
  dimension: ['displayName'],
  metric: ['displayName'],
  keyEvent: [],
  /** `membershipDurationDays`/`exclusionDurationMode`/`filterClauses` are immutable — `plan` refuses to reach here if they changed. */
  audience: ['displayName', 'description'],
  eventCreateRule: ['eventConditions', 'sourceCopyParameters', 'parameterMutations'],
  /** `processingOrder` is output-only — GA4 rejects it in any `updateMask` (confirmed live 2026-08-29). */
  eventEditRule: ['displayName', 'eventConditions', 'parameterMutations'],
  /** `calculatedMetricId` is immutable and create-only, not part of any update mask. */
  calculatedMetric: ['displayName', 'metricUnit', 'formula', 'description'],
  channelGroup: ['displayName', 'description', 'groupingRule', 'primary'],
  measurementProtocolSecret: ['displayName'],
};

export async function apply(opts: GlobalOptions): Promise<void> {
  try {
    const result = await computePlan(opts, [SCOPES.gtmEdit, SCOPES.ga4Edit]);

    if (result.changes.length === 0 && result.builtInVariablesToEnable.length === 0 && !hasGa4SettingsChanges(result.ga4Settings)) {
      console.log('No changes.');
      return;
    }

    if (await result.gtm.hasSyncConflicts()) throw new WorkspaceConflictError(result.config.google.gtm.containerId);

    if (result.counts.delete > 0 && !opts.allowDestroy) {
      throw new Error(
        `This apply would delete ${result.counts.delete} resource${result.counts.delete === 1 ? '' : 's'}. ` +
          'Pass --allow-destroy to allow apply to include deletes.',
      );
    }

    const protectedDeletes = findProtectedDeletes(result.changes);
    if (protectedDeletes.length > 0 && !opts.allowDestroyProtected) {
      throw new Error(
        'This apply would delete protected resource(s): ' +
          protectedDeletes.map((c) => c.resource.id).join(', ') +
          '. Pass --allow-destroy-protected to allow it.',
      );
    }

    printDestructiveWarnings(result.changes);
    console.log('Apply these changes?\n');
    console.log(`${result.counts.create} to create`);
    console.log(`${result.counts.update} to update`);
    console.log(`${result.counts.delete} to delete`);
    if (result.builtInVariablesToEnable.length > 0) console.log(`${result.builtInVariablesToEnable.length} built-in variable(s) to enable`);
    if (hasGa4SettingsChanges(result.ga4Settings)) {
      console.log(`GA4 property/stream settings to update: ${describeGa4SettingsChanges(result.ga4Settings).join(', ')}`);
    }
    console.log('');

    if (!opts.autoApprove && !(await confirm())) {
      console.log('Cancelled.');
      return;
    }

    await withStateLock(result.statePath, () => execute(result));
    console.log('Apply complete.');
  } catch (error) {
    printFailure(error);
    process.exitCode = 1;
  }
}

/** Deletes of resources marked `protected: true`, which need `--allow-destroy-protected` on top of `--allow-destroy`. */
export function findProtectedDeletes(changes: Change[]): Array<Extract<Change, { operation: 'delete' }>> {
  return changes.filter(
    (c): c is Extract<Change, { operation: 'delete' }> =>
      c.operation === 'delete' && (c.resource.desiredState as Record<string, unknown>)?.protected === true,
  );
}

function printDestructiveWarnings(changes: Change[]): void {
  for (const change of changes) {
    if (change.operation !== 'delete') continue;
    const kind = change.resource.type.startsWith('gtm.') ? 'GTM' : 'GA4';
    console.log(`⚠ DELETE\n\n${kind} ${change.resource.type.split('.')[1]}:\n${change.resource.id}\n`);
  }
}


async function execute(result: PlanResult): Promise<void> {
  const { changes, compiled, gtm, ga4, statePath } = result;
  let state = await readState(statePath);
  const triggerGtmIds = invert(result.triggerGtmIdToLogicalId);
  const folderGtmIds = invert(result.folderGtmIdToLogicalId);

  // Enabled first: tags/triggers created below may reference these by name.
  await gtm.enableBuiltInVariables(result.builtInVariablesToEnable);

  const { ga4Settings } = result;
  if (ga4Settings.dataRetention) {
    await ga4.updateDataRetentionSettings(ga4Settings.dataRetention.patch, ga4Settings.dataRetention.updateMask);
  }
  if (ga4Settings.googleSignals) {
    await ga4.updateGoogleSignalsSettings(ga4Settings.googleSignals.patch, ga4Settings.googleSignals.updateMask);
  }
  if (ga4Settings.attributionSettings) {
    await ga4.updateAttributionSettings(ga4Settings.attributionSettings.patch, ga4Settings.attributionSettings.updateMask);
  }
  if (ga4Settings.enhancedMeasurement && ga4Settings.streamName) {
    await ga4.updateEnhancedMeasurementSettings(
      ga4Settings.streamName,
      ga4Settings.enhancedMeasurement.patch,
      ga4Settings.enhancedMeasurement.updateMask,
    );
  }

  const gtmChangesByKind = groupGtm(changes);
  const ga4Changes = changes.filter((c) => resourceOf(c).type.startsWith('ga4.'));

  const isDelete = (c: Change): c is Extract<Change, { operation: 'delete' }> => c.operation === 'delete';
  const isUpdate = (c: Change): c is Extract<Change, { operation: 'update' }> => c.operation === 'update';
  const isCreate = (c: Change): c is Extract<Change, { operation: 'create' }> => c.operation === 'create';

  // Reverse dependency order: a tag must go before the trigger/variable it uses.
  for (const kind of [...GTM_KIND_ORDER].reverse()) {
    for (const change of gtmChangesByKind[kind].filter(isDelete)) {
      const gtmId = result.gtmIds[`${kind}:${change.resource.id}`];
      if (!gtmId) continue;
      await gtm.delete(kind, change.resource.id, gtmId);
    }
  }
  for (const change of ga4Changes.filter(isDelete)) {
    const kind = ga4KindOf(change.resource.type);
    const name = result.ga4Names[`${kind}:${change.resource.id}`];
    if (!name) continue;
    await ga4.delete(kind, name);
    state = forgetManaged(state, ga4.stateKeyFor(kind, change.resource.id));
    await writeState(statePath, state);
  }

  // Dependency order, tracking new trigger ids so a tag created in the same run can reference them.
  const order = buildDependencyGraph(compiled).topologicalOrder();
  const createsById = new Map(
    changes.filter(isCreate).filter((c) => c.resource.type.startsWith('gtm.')).map((c) => [`${c.resource.type.split('.')[1]}:${c.resource.id}`, c]),
  );
  for (const node of order) {
    const change = createsById.get(node);
    if (!change) continue;
    const kind = change.resource.type.split('.')[1] as GtmKind;
    const payload = toGtmPayload(kind, change.resource.id, change.resource.desiredState as Record<string, unknown>, {
      measurementId: result.measurementId,
      triggerGtmIds,
      folderGtmIds,
    });
    const isProtected = (change.resource.desiredState as Record<string, unknown>).protected === true;
    const created = await gtm.create(kind, change.resource.id, payload, isProtected);
    const gtmId = created[gtmIdField(kind)];
    if (typeof gtmId === 'string') {
      if (kind === 'trigger') triggerGtmIds[change.resource.id] = gtmId;
      if (kind === 'folder') folderGtmIds[change.resource.id] = gtmId;
    }
  }
  for (const change of ga4Changes.filter(isCreate)) {
    const kind = ga4KindOf(change.resource.type);
    const payload = toGa4Payload(kind, change.resource.id, change.resource.desiredState as Record<string, unknown>);
    const created = await ga4.create(kind, payload, ga4Settings.streamName, change.resource.id);
    if (created.name) {
      const key = ga4.stateKeyFor(kind, change.resource.id);
      state = recordManaged(state, key, created.name);
      if ((change.resource.desiredState as Record<string, unknown>).protected === true) state = setProtected(state, key, true);
      await writeState(statePath, state);
    }
  }

  for (const kind of GTM_KIND_ORDER) {
    for (const change of gtmChangesByKind[kind].filter(isUpdate)) {
      const id = change.after.id;
      const gtmId = result.gtmIds[`${kind}:${id}`];
      if (!gtmId) continue;
      const payload = toGtmPayload(kind, id, change.after.desiredState as Record<string, unknown>, {
        measurementId: result.measurementId,
        triggerGtmIds,
        folderGtmIds,
      });
      const isProtected = (change.after.desiredState as Record<string, unknown>).protected === true;
      await gtm.update(kind, id, gtmId, payload, isProtected);
    }
  }
  for (const change of ga4Changes.filter(isUpdate)) {
    const kind = ga4KindOf(change.after.type);
    const name = result.ga4Names[`${kind}:${change.after.id}`];
    if (!name) continue;
    const payload = toGa4Payload(kind, change.after.id, change.after.desiredState as Record<string, unknown>);
    await ga4.update(kind, name, payload, GA4_UPDATE_MASK[kind]);
    const key = ga4.stateKeyFor(kind, change.after.id);
    state = setProtected(state, key, (change.after.desiredState as Record<string, unknown>).protected === true);
    await writeState(statePath, state);
  }
}

function groupGtm(changes: Change[]): Record<GtmKind, Change[]> {
  const groups: Record<GtmKind, Change[]> = { folder: [], variable: [], trigger: [], tag: [] };
  for (const change of changes) {
    const type = resourceOf(change).type;
    if (!type.startsWith('gtm.')) continue;
    groups[type.split('.')[1] as GtmKind].push(change);
  }
  return groups;
}

function ga4KindOf(type: string): Ga4Kind {
  return type.split('.')[1] as Ga4Kind;
}

function resourceOf(change: Change): Resource {
  return change.operation === 'update' ? change.after : change.resource;
}

function invert(map: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [gtmId, logicalId] of Object.entries(map)) result[logicalId] = gtmId;
  return result;
}

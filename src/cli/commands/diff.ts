import { loadConfig } from '../../config/loader.js';
import { interpolateConfig } from '../../config/interpolation.js';
import { validateConfig } from '../../config/schema.js';
import { compileEvents, toResources } from '../../core/compile.js';
import { deepEqual, diff as diffResources } from '../../core/diff.js';
import type { Change, Resource } from '../../core/resource.js';
import { buildPlanJson, buildPlanMarkdown, type PlanJson } from './plan.js';
import { printFailure } from '../failure.js';
import type { GlobalOptions } from '../options.js';
import type { AnalyticsConfig } from '../../config/schema.js';

const KIND_LABEL: Record<string, string> = {
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

export interface ConfigChange {
  path: string;
  before?: unknown;
  after?: unknown;
}

export interface DiffResult {
  configChanges: ConfigChange[];
  changes: Change[];
  counts: { create: number; update: number; delete: number };
}

/** Pure, offline: no network, no `authorize()`. Loads both files independently through the
 * same load → interpolate → validate → compile pipeline `plan` uses, then diffs the two
 * resource lists. `fileB` is "desired", `fileA` is the baseline it is compared against —
 * the result reads as "what would change going from fileA to fileB". */
export function computeDiff(fileA: string, fileB: string, environment?: string): DiffResult {
  const configOf = (path: string): AnalyticsConfig => {
    const parsed = loadConfig(path, environment);
    const interpolated = { ...parsed, data: interpolateConfig(parsed) };
    const config = validateConfig(interpolated);
    const compiled = compileEvents(config, parsed.file);
    return compiled;
  };

  const baseline = configOf(fileA);
  const desired = configOf(fileB);
  const changes = diffResources(toResources(desired), toResources(baseline));
  const configChanges = diffConfigSettings(baseline, desired);

  const counts = { create: 0, update: 0, delete: 0 };
  for (const change of changes) counts[change.operation]++;

  return { changes, counts, configChanges };
}

export async function diff(fileA: string, fileB: string, opts: GlobalOptions): Promise<void> {
  try {
    const result = computeDiff(fileA, fileB, opts.env);
    render(result, opts.format);
    if (result.changes.length > 0 || result.configChanges.length > 0) process.exitCode = 2;
  } catch (error) {
    printFailure(error);
    process.exitCode = 1;
  }
}

function render(result: DiffResult, format: GlobalOptions['format']): void {
  if (format === 'json') return console.log(JSON.stringify(buildDiffJson(result), null, 2));
  if (format === 'markdown') return console.log(buildDiffMarkdown(result));
  renderText(result);
}

function renderText({ changes, counts, configChanges }: DiffResult): void {
  console.log('GTM as Code diff\n');

  for (const change of changes.filter((c) => c.operation === 'create')) printLine('+', 'create', change);
  for (const change of changes.filter((c) => c.operation === 'update')) {
    printLine('~', 'update', change);
    if (change.operation === 'update') printFieldDiff(change.before.desiredState, change.after.desiredState);
  }
  for (const change of changes.filter((c) => c.operation === 'delete')) printLine('-', 'delete', change);

  if (configChanges.length > 0) {
    console.log('Configuration declarations (removing a declaration does not reset Google settings):');
    for (const change of configChanges) console.log(`  ${change.path}: ${describe(change.before)} → ${describe(change.after)}`);
  }

  console.log('Diff:');
  console.log(`  ${counts.create} to create`);
  console.log(`  ${counts.update} to update`);
  console.log(`  ${counts.delete} to delete`);
}

function resourceOf(change: Change): Resource {
  return change.operation === 'update' ? change.after : change.resource;
}

function printLine(symbol: string, action: string, change: Change): void {
  const resource = resourceOf(change);
  const kind = KIND_LABEL[resource.type] ?? resource.type;
  const label = `${symbol} ${action} ${kind}`;
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

/** Offline declaration comparison; these changes are never passed to the apply resource executor. */
function diffConfigSettings(before: AnalyticsConfig, after: AnalyticsConfig): ConfigChange[] {
  const changes: ConfigChange[] = [];
  const compare = (path: string, a: unknown, b: unknown) => {
    if (!deepEqual(a, b)) changes.push({ path, ...(a !== undefined ? { before: a } : {}), ...(b !== undefined ? { after: b } : {}) });
  };
  compare('gtm.builtInVariables', [...before.gtm.builtInVariables].sort(), [...after.gtm.builtInVariables].sort());
  for (const key of ['dataRetention', 'googleSignals', 'streamWebsiteUrl', 'attributionSettings', 'enhancedMeasurement'] as const) {
    compare(`ga4.${key}`, before.ga4[key], after.ga4[key]);
  }
  return changes;
}

export function buildDiffJson(result: DiffResult): PlanJson & { configChanges?: ConfigChange[] } {
  const json = buildPlanJson(result);
  return result.configChanges.length > 0
    ? { ...json, hasChanges: true, configChanges: result.configChanges }
    : json;
}

export function buildDiffMarkdown(result: DiffResult): string {
  if (result.configChanges.length === 0) return buildPlanMarkdown(result);
  const lines = [result.changes.length > 0 ? buildPlanMarkdown(result) : '**GTM as Code diff**', '',
    'Configuration declarations (removing a declaration does not reset Google settings):', ''];
  for (const change of result.configChanges) {
    lines.push(`- ${change.path}: ${describe(change.before)} → ${describe(change.after)}`);
  }
  return lines.join('\n');
}

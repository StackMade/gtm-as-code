import { loadConfig } from '../../config/loader.js';
import { interpolateConfig } from '../../config/interpolation.js';
import { validateConfig } from '../../config/schema.js';
import { compileEvents, toResources } from '../../core/compile.js';
import { diff as diffResources } from '../../core/diff.js';
import type { Change, Resource } from '../../core/resource.js';
import { buildPlanJson, buildPlanMarkdown, type PlanJson } from './plan.js';
import { printFailure } from '../failure.js';
import type { GlobalOptions } from '../options.js';

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
};

export interface DiffResult {
  changes: Change[];
  counts: { create: number; update: number; delete: number };
}

/** Pure, offline: no network, no `authorize()`. Loads both files independently through the
 * same load → interpolate → validate → compile pipeline `plan` uses, then diffs the two
 * resource lists. `fileB` is "desired", `fileA` is the baseline it is compared against —
 * the result reads as "what would change going from fileA to fileB". */
export function computeDiff(fileA: string, fileB: string): DiffResult {
  const resourcesOf = (path: string): Resource[] => {
    const parsed = loadConfig(path);
    const interpolated = { ...parsed, data: interpolateConfig(parsed) };
    const config = validateConfig(interpolated);
    const compiled = compileEvents(config, parsed.file);
    return toResources(compiled);
  };

  const baseline = resourcesOf(fileA);
  const desired = resourcesOf(fileB);
  const changes = diffResources(desired, baseline);

  const counts = { create: 0, update: 0, delete: 0 };
  for (const change of changes) counts[change.operation]++;

  return { changes, counts };
}

export async function diff(fileA: string, fileB: string, opts: GlobalOptions): Promise<void> {
  try {
    const result = computeDiff(fileA, fileB);
    render(result, opts.format);
    if (result.changes.length > 0) process.exitCode = 2;
  } catch (error) {
    printFailure(error);
    process.exitCode = 1;
  }
}

function render(result: DiffResult, format: GlobalOptions['format']): void {
  if (format === 'json') return console.log(JSON.stringify(buildPlanJson(result) satisfies PlanJson, null, 2));
  if (format === 'markdown') return console.log(buildPlanMarkdown(result));
  renderText(result);
}

function renderText({ changes, counts }: DiffResult): void {
  console.log('GTM as Code diff\n');

  for (const change of changes.filter((c) => c.operation === 'create')) printLine('+', 'create', change);
  for (const change of changes.filter((c) => c.operation === 'update')) {
    printLine('~', 'update', change);
    if (change.operation === 'update') printFieldDiff(change.before.desiredState, change.after.desiredState);
  }
  for (const change of changes.filter((c) => c.operation === 'delete')) printLine('-', 'delete', change);

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
  console.log(`${symbol} ${action} ${kind}`.padEnd(20) + resource.id);
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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPlanJson, buildPlanMarkdown, planJsonWithBuiltIns, planMarkdownWithBuiltIns, type PlanResult } from './plan.js';
import type { Change } from '../../core/resource.js';
import type { Ga4SettingsDiff } from '../../providers/google/ga4/settings.js';

function resultWith(changes: Change[], ga4Settings: Ga4SettingsDiff = {}): PlanResult {
  const counts = { create: 0, update: 0, delete: 0 };
  for (const change of changes) counts[change.operation]++;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { changes, counts, builtInVariablesToEnable: [], ga4Settings } as any as PlanResult;
}

const createTrigger: Change = {
  operation: 'create',
  resource: { id: 'generate_lead', type: 'gtm.trigger', provider: 'google', desiredState: {} },
};
const deleteDimension: Change = {
  operation: 'delete',
  resource: { id: 'lead_type', type: 'ga4.dimension', provider: 'google', desiredState: {} },
};

test('buildPlanJson reports hasChanges, counts, and a flat change list', () => {
  const json = buildPlanJson(resultWith([createTrigger, deleteDimension]));

  assert.deepEqual(json, {
    hasChanges: true,
    counts: { create: 1, update: 0, delete: 1 },
    changes: [
      { operation: 'create', type: 'gtm.trigger', id: 'generate_lead' },
      { operation: 'delete', type: 'ga4.dimension', id: 'lead_type' },
    ],
  });
});

test('buildPlanJson reports hasChanges: false with an empty change list', () => {
  assert.deepEqual(buildPlanJson(resultWith([])), { hasChanges: false, counts: { create: 0, update: 0, delete: 0 }, changes: [] });
});

test('buildPlanMarkdown renders a counts line and one table row per change', () => {
  const markdown = buildPlanMarkdown(resultWith([createTrigger, deleteDimension]));

  assert.match(markdown, /1 to create, 0 to update, 1 to delete/);
  assert.match(markdown, /\| \+ create \| trigger \| `generate_lead` \|/);
  assert.match(markdown, /\| - delete \| custom dimension \| `lead_type` \|/);
});

test('buildPlanMarkdown reports no changes without a table', () => {
  assert.equal(buildPlanMarkdown(resultWith([])), '**GTM as Code**: no changes.');
});

test('planJsonWithBuiltIns adds a ga4Settings key only when a setting actually differs', () => {
  const dataRetention = { patch: { eventDataRetention: 'FOURTEEN_MONTHS' }, updateMask: ['eventDataRetention'] };
  const json = planJsonWithBuiltIns(resultWith([], { dataRetention }));
  assert.deepEqual(json.ga4Settings, { dataRetention });
  assert.equal(planJsonWithBuiltIns(resultWith([])).ga4Settings, undefined);
});

test('planMarkdownWithBuiltIns lists each GA4 setting that changed', () => {
  const markdown = planMarkdownWithBuiltIns(
    resultWith([], {
      dataRetention: { patch: { eventDataRetention: 'FOURTEEN_MONTHS' }, updateMask: ['eventDataRetention'] },
      googleSignals: { patch: { state: 'GOOGLE_SIGNALS_DISABLED' }, updateMask: ['state'] },
    }),
  );
  assert.match(markdown, /GA4 settings to update: dataRetention → FOURTEEN_MONTHS, googleSignals → GOOGLE_SIGNALS_DISABLED/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPlanJson, buildPlanMarkdown, planJsonWithBuiltIns, planMarkdownWithBuiltIns, checkAudienceImmutableFields, checkUndeletableKeyEvents, type PlanResult } from './plan.js';
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

test('checkAudienceImmutableFields is a no-op when only displayName/description-equivalent fields change', () => {
  const change: Change = {
    operation: 'update',
    before: { id: 'a', type: 'ga4.audience', provider: 'google', desiredState: { description: 'old', membershipDurationDays: 30, filterClauses: [1] } },
    after: { id: 'a', type: 'ga4.audience', provider: 'google', desiredState: { description: 'new', membershipDurationDays: 30, filterClauses: [1] } },
  };
  assert.doesNotThrow(() => checkAudienceImmutableFields([change]));
});

test('checkAudienceImmutableFields throws naming the field when filterClauses changes on an existing audience', () => {
  const change: Change = {
    operation: 'update',
    before: { id: 'a', type: 'ga4.audience', provider: 'google', desiredState: { membershipDurationDays: 30, filterClauses: [1] } },
    after: { id: 'a', type: 'ga4.audience', provider: 'google', desiredState: { membershipDurationDays: 30, filterClauses: [2] } },
  };
  assert.throws(() => checkAudienceImmutableFields([change]), /ga4\.audiences\.a changes filterClauses/);
});

test('checkAudienceImmutableFields ignores create/delete and non-audience updates', () => {
  const audienceCreate: Change = { operation: 'create', resource: { id: 'a', type: 'ga4.audience', provider: 'google', desiredState: {} } };
  const dimensionUpdate: Change = {
    operation: 'update',
    before: { id: 'd', type: 'ga4.dimension', provider: 'google', desiredState: { scope: 'event', parameter: 'x' } },
    after: { id: 'd', type: 'ga4.dimension', provider: 'google', desiredState: { scope: 'user', parameter: 'x' } },
  };
  assert.doesNotThrow(() => checkAudienceImmutableFields([audienceCreate, dimensionUpdate, deleteDimension]));
});

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

const deletePurchaseKeyEvent: Change = {
  operation: 'delete',
  resource: { id: 'purchase', type: 'ga4.keyEvent', provider: 'google', desiredState: {} },
};

test('checkUndeletableKeyEvents throws naming a key event GA4 reports as not deletable', () => {
  assert.throws(
    () => checkUndeletableKeyEvents([deletePurchaseKeyEvent], new Set(['purchase'])),
    /ga4\.keyEvents\.purchase is a key event GA4 reports as not deletable/,
  );
});

test('checkUndeletableKeyEvents allows deleting a custom key event', () => {
  assert.doesNotThrow(() => checkUndeletableKeyEvents([deletePurchaseKeyEvent], new Set(['generate_lead'])));
});

test('checkUndeletableKeyEvents ignores non-delete changes and other kinds', () => {
  const update: Change = {
    operation: 'update',
    before: { id: 'purchase', type: 'ga4.keyEvent', provider: 'google', desiredState: {} },
    after: { id: 'purchase', type: 'ga4.keyEvent', provider: 'google', desiredState: { protected: true } },
  };
  assert.doesNotThrow(() => checkUndeletableKeyEvents([update, deleteDimension], new Set(['purchase', 'lead_type'])));
});

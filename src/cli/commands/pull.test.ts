import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  slugify,
  uniqueSlug,
  assignIds,
  parseResourceArg,
  buildFoundSummary,
  mergeResourceIntoConfig,
  type FoundCounts,
} from './pull.js';

test('slugify lowercases and collapses non [a-z0-9_] runs to a single underscore', () => {
  assert.equal(slugify('Generate Lead Tag'), 'generate_lead_tag');
  assert.equal(slugify('GA4 - Purchase!!'), 'ga4_purchase');
  assert.equal(slugify('__leading and trailing__'), 'leading_and_trailing');
});

test('slugify falls back to "unnamed" for a name with no safe characters via uniqueSlug', () => {
  const used = new Set<string>();
  assert.equal(uniqueSlug('!!!', used), 'unnamed');
});

test('uniqueSlug suffixes collisions with _2, _3, ...', () => {
  const used = new Set<string>();
  assert.equal(uniqueSlug('Lead', used), 'lead');
  assert.equal(uniqueSlug('Lead', used), 'lead_2');
  assert.equal(uniqueSlug('Lead', used), 'lead_3');
});

test('assignIds assigns one deduped slug per object, in order', () => {
  const ids = assignIds([{ name: 'Lead' }, { name: 'Lead' }, { name: 'Other Tag' }]);
  assert.deepEqual(ids, ['lead', 'lead_2', 'other_tag']);
});

test('parseResourceArg splits kind:id and validates the kind', () => {
  assert.deepEqual(parseResourceArg('tag:generate_lead_tag'), { kind: 'tag', id: 'generate_lead_tag' });
  assert.deepEqual(parseResourceArg('dimension:lead_type'), { kind: 'dimension', id: 'lead_type' });
});

test('parseResourceArg rejects a missing separator', () => {
  assert.throws(() => parseResourceArg('generate_lead_tag'), /Expected <kind>:<id>/);
});

test('parseResourceArg rejects an unknown kind', () => {
  assert.throws(() => parseResourceArg('widget:foo'), /Kind must be one of/);
});

test('parseResourceArg rejects an empty id', () => {
  assert.throws(() => parseResourceArg('tag:'), /Kind must be one of/);
});

function countsWith(overrides: Partial<FoundCounts> = {}): FoundCounts {
  return {
    folders: 0,
    variables: 0,
    triggers: 0,
    tags: 0,
    dimensions: 0,
    metrics: 0,
    keyEvents: 0,
    audiences: 0,
    eventCreateRules: 0,
    eventEditRules: 0,
    calculatedMetrics: 0,
    channelGroups: 0,
    measurementProtocolSecrets: 0,
    skipped: 0,
    ...overrides,
  };
}

test('buildFoundSummary reports one line per kind in PRD order', () => {
  const lines = buildFoundSummary(countsWith({ tags: 18, triggers: 22, variables: 15, dimensions: 7, keyEvents: 3 }));
  assert.deepEqual(lines, [
    'Found:',
    '',
    '  18 tags',
    '  22 triggers',
    '  15 variables',
    '  0 folders',
    '  7 custom dimensions',
    '  0 custom metrics',
    '  3 key events',
    '  0 audiences',
    '  0 event create rules',
    '  0 event edit rules',
    '  0 calculated metrics',
    '  0 channel groups',
    '  0 measurement protocol secrets',
  ]);
});

test('buildFoundSummary appends a skipped line only when something was skipped', () => {
  const lines = buildFoundSummary(countsWith({ skipped: 2 }));
  assert.deepEqual(lines.at(-1), '  2 skipped (no reverse mapping for this GTM object type)');
});

function baseConfig(): Record<string, unknown> {
  return {
    version: 1,
    project: { name: 'acme' },
    google: {
      gtm: { accountId: '${GTM_ACCOUNT_ID}', containerId: '2' },
      ga4: { propertyId: '3' },
    },
    events: {},
    gtm: { variables: {}, triggers: { existing_trigger: { type: 'customEvent', eventName: 'x' } }, tags: {} },
    ga4: {
      dimensions: {},
      metrics: {},
      keyEvents: {},
      audiences: {},
      eventCreateRules: {},
      eventEditRules: {},
      calculatedMetrics: {},
      channelGroups: {},
    },
  };
}

test('mergeResourceIntoConfig adds a new resource without touching the rest of the config', () => {
  const config = baseConfig();
  const next = mergeResourceIntoConfig(config, 'tag', 'generate_lead_tag', { type: 'ga4Event', eventName: 'generate_lead' });

  const gtm = next.gtm as { tags: unknown; triggers: unknown };
  assert.deepEqual(gtm.tags, { generate_lead_tag: { type: 'ga4Event', eventName: 'generate_lead' } });
  assert.deepEqual(gtm.triggers, (config.gtm as { triggers: unknown }).triggers);
  assert.equal((config.gtm as { tags: Record<string, unknown> }).tags.generate_lead_tag, undefined, 'original config is not mutated');
});

test('mergeResourceIntoConfig replaces an existing resource with the same id', () => {
  const config = baseConfig();
  const next = mergeResourceIntoConfig(config, 'trigger', 'existing_trigger', { type: 'customEvent', eventName: 'y' });

  assert.deepEqual((next.gtm as { triggers: unknown }).triggers, { existing_trigger: { type: 'customEvent', eventName: 'y' } });
});

test('mergeResourceIntoConfig places a GA4 resource under ga4', () => {
  const config = baseConfig();
  const next = mergeResourceIntoConfig(config, 'dimension', 'lead_type', { scope: 'event', parameter: 'lead_type' });

  assert.deepEqual((next.ga4 as { dimensions: unknown }).dimensions, { lead_type: { scope: 'event', parameter: 'lead_type' } });
});

test('mergeResourceIntoConfig leaves unrelated env-placeholder values in the raw config untouched', () => {
  const config = baseConfig();
  const next = mergeResourceIntoConfig(config, 'tag', 'generate_lead_tag', { type: 'ga4Event', eventName: 'generate_lead' });

  assert.equal((next.google as { gtm: { accountId: string } }).gtm.accountId, '${GTM_ACCOUNT_ID}');
});

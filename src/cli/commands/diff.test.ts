import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeDiff, buildDiffJson, buildDiffMarkdown } from './diff.js';

const BASE_YAML = `
version: 1
project:
  name: test
google:
  gtm:
    accountId: "1"
    containerId: "1"
  ga4:
    propertyId: "1"
events:
  generate_lead:
    keyEvent: true
    parameters:
      form:
        type: string
        dimension: true
    consent:
      status: notNeeded
`;

const CHANGED_YAML = `
version: 1
project:
  name: test
google:
  gtm:
    accountId: "1"
    containerId: "1"
  ga4:
    propertyId: "1"
events:
  generate_lead:
    keyEvent: true
    parameters:
      form:
        type: string
        dimension: true
    consent:
      status: notNeeded
  purchase:
    keyEvent: true
    parameters:
      value:
        type: number
        dimension: true
    consent:
      status: notNeeded
`;

function writeFixture(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'gtm-diff-test-'));
  const path = join(dir, name);
  writeFileSync(path, contents, 'utf8');
  return path;
}

test('computeDiff finds no changes between a config and itself', () => {
  const fileA = writeFixture('a.yaml', BASE_YAML);
  const fileB = writeFixture('b.yaml', BASE_YAML);

  const result = computeDiff(fileA, fileB);

  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.counts, { create: 0, update: 0, delete: 0 });
});

test('computeDiff reports creates for resources only in fileB (the desired side)', () => {
  const fileA = writeFixture('a.yaml', BASE_YAML);
  const fileB = writeFixture('b.yaml', CHANGED_YAML);

  const result = computeDiff(fileA, fileB);

  assert.equal(result.counts.create > 0, true);
  const createdIds = result.changes.filter((c) => c.operation === 'create').map((c) => c.resource.id);
  assert.ok(createdIds.includes('purchase'));
});

test('computeDiff reports deletes when fileA has resources fileB drops', () => {
  const fileA = writeFixture('a.yaml', CHANGED_YAML);
  const fileB = writeFixture('b.yaml', BASE_YAML);

  const result = computeDiff(fileA, fileB);

  assert.equal(result.counts.delete > 0, true);
  const deletedIds = result.changes.filter((c) => c.operation === 'delete').map((c) => c.resource.id);
  assert.ok(deletedIds.includes('purchase'));
});

test('offline diff reports settings and built-in declarations without inventing resource deletes', () => {
  const before = writeFixture('before.yaml', BASE_YAML + '\nga4:\n  dataRetention: TWO_MONTHS\n  googleSignals: GOOGLE_SIGNALS_ENABLED\ngtm:\n  builtInVariables: ["Click ID"]\n');
  const after = writeFixture('after.yaml', BASE_YAML + '\nga4:\n  dataRetention: FOURTEEN_MONTHS\ngtm:\n  builtInVariables: []\n');
  const result = computeDiff(before, after);
  assert.deepEqual(result.counts, { create: 0, update: 0, delete: 0 });
  assert.deepEqual(result.configChanges, [
    { path: 'gtm.builtInVariables', before: ['Click ID'], after: [] },
    { path: 'ga4.dataRetention', before: 'TWO_MONTHS', after: 'FOURTEEN_MONTHS' },
    { path: 'ga4.googleSignals', before: 'GOOGLE_SIGNALS_ENABLED' },
  ]);
  assert.equal(buildDiffJson(result).hasChanges, true);
  assert.deepEqual(buildDiffJson(result).configChanges, result.configChanges);
  assert.doesNotMatch(buildDiffMarkdown(result), /no changes/i);
  assert.match(buildDiffMarkdown(result), /does not reset Google settings/);
  const unchanged = computeDiff(after, after);
  assert.deepEqual(unchanged.configChanges, []);
  assert.equal(buildDiffJson(unchanged).hasChanges, false);
});

test('offline diff compares nested stream settings and ignores built-in ordering', () => {
  const before = writeFixture('before.yaml', BASE_YAML + '\nga4:\n  streamWebsiteUrl: https://example.com\n  enhancedMeasurement: {scrollsEnabled: true}\ngtm:\n  builtInVariables: ["Click ID", "Page URL"]\n');
  const after = writeFixture('after.yaml', BASE_YAML + '\nga4:\n  streamWebsiteUrl: https://example.com\n  enhancedMeasurement: {scrollsEnabled: false}\ngtm:\n  builtInVariables: ["Page URL", "Click ID"]\n');
  assert.deepEqual(computeDiff(before, after).configChanges, [
    { path: 'ga4.enhancedMeasurement', before: { scrollsEnabled: true }, after: { scrollsEnabled: false } },
  ]);
});

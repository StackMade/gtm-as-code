import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeDiff } from './diff.js';

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

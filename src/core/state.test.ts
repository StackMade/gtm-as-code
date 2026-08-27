import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { emptyState, findManagedId, forgetManaged, readState, recordManaged, stateKey, writeState } from './state.js';

test('recordManaged then findManagedId recovers the resource id', () => {
  const key = stateKey('google', 'ga4.dimension', '123456789', 'lead_type');
  const state = recordManaged(emptyState(), key, 'properties/123456789/customDimensions/123');

  assert.equal(
    findManagedId(state, 'google', 'ga4.dimension', '123456789', 'properties/123456789/customDimensions/123'),
    'lead_type',
  );
});

test('findManagedId is scoped by provider/type/scope — no cross-property leakage', () => {
  const key = stateKey('google', 'ga4.dimension', '123456789', 'lead_type');
  const state = recordManaged(emptyState(), key, 'properties/123456789/customDimensions/123');

  assert.equal(
    findManagedId(state, 'google', 'ga4.dimension', 'OTHER_PROPERTY', 'properties/123456789/customDimensions/123'),
    null,
  );
});

test('forgetManaged removes the entry', () => {
  const key = stateKey('google', 'ga4.keyEvent', '123456789', 'generate_lead');
  const withEntry = recordManaged(emptyState(), key, 'properties/123456789/keyEvents/456');
  const withoutEntry = forgetManaged(withEntry, key);

  assert.deepEqual(withoutEntry.resources, {});
});

test('readState returns an empty state when the file does not exist', async () => {
  const state = await readState('/nonexistent/.analytics/state.json');
  assert.deepEqual(state, emptyState());
});

test('writeState leaves no temporary file behind — the state file is renamed into place', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gtm-as-code-state-'));
  try {
    const path = join(dir, 'state.json');
    await writeState(path, emptyState());
    await writeState(path, recordManaged(emptyState(), 'k', 'v'));

    assert.deepEqual(await readdir(dir), ['state.json']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeState then readState round-trips, creating the parent directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gtm-as-code-state-'));
  try {
    const path = join(dir, '.analytics', 'state.json');
    const key = stateKey('google', 'ga4.dimension', '123456789', 'lead_type');
    const state = recordManaged(emptyState(), key, 'properties/123456789/customDimensions/123');

    await writeState(path, state);
    const reread = await readState(path);

    assert.deepEqual(reread, state);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

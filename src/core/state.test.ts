import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeFile } from 'node:fs/promises';
import {
  emptyState,
  findManagedId,
  forgetManaged,
  isProtected,
  readState,
  recordManaged,
  setProtected,
  stateKey,
  writeState,
  StateVersionError,
} from './state.js';

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

test('setProtected then isProtected round-trips', () => {
  const key = stateKey('google', 'ga4.dimension', '123456789', 'lead_type');
  const state = setProtected(recordManaged(emptyState(), key, 'properties/123456789/customDimensions/123'), key, true);

  assert.equal(isProtected(state, key), true);
});

test('setProtected(false) clears a previously protected resource', () => {
  const key = stateKey('google', 'ga4.dimension', '123456789', 'lead_type');
  const protectedState = setProtected(emptyState(), key, true);
  const unprotectedState = setProtected(protectedState, key, false);

  assert.equal(isProtected(unprotectedState, key), false);
});

test('forgetManaged also clears the protected flag, so a re-created resource starts unprotected', () => {
  const key = stateKey('google', 'ga4.keyEvent', '123456789', 'generate_lead');
  const state = setProtected(recordManaged(emptyState(), key, 'properties/123456789/keyEvents/456'), key, true);
  const forgotten = forgetManaged(state, key);

  assert.equal(isProtected(forgotten, key), false);
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

test('readState rejects a state file whose version this CLI does not understand', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gtm-as-code-state-'));
  try {
    const path = join(dir, 'state.json');
    await writeFile(path, JSON.stringify({ version: 2, resources: {} }), 'utf8');

    await assert.rejects(() => readState(path), StateVersionError);
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

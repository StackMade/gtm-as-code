import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { withStateLock, StateLockedError } from './lock.js';

test('withStateLock runs fn and removes the lock file afterwards', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gtm-as-code-lock-'));
  try {
    const statePath = join(dir, 'state.json');
    const result = await withStateLock(statePath, async () => 'done');

    assert.equal(result, 'done');
    await assert.rejects(() => stat(`${statePath}.lock`));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('withStateLock removes the lock file even when fn throws', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gtm-as-code-lock-'));
  try {
    const statePath = join(dir, 'state.json');

    await assert.rejects(
      () =>
        withStateLock(statePath, async () => {
          throw new Error('boom');
        }),
      /boom/,
    );
    await assert.rejects(() => stat(`${statePath}.lock`));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('withStateLock refuses to run fn while another lock is held', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gtm-as-code-lock-'));
  try {
    const statePath = join(dir, 'state.json');
    let released: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      released = resolve;
    });

    const first = withStateLock(statePath, () => held);
    await new Promise((resolve) => setImmediate(resolve));

    await assert.rejects(() => withStateLock(statePath, async () => 'should not run'), StateLockedError);

    released?.();
    await first;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

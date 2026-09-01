import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
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
    await waitForFile(`${statePath}.lock`);

    await assert.rejects(() => withStateLock(statePath, async () => 'should not run'), StateLockedError);

    released?.();
    await first;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('withStateLock takes over a lock whose process is gone', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gtm-as-code-lock-'));
  try {
    const statePath = join(dir, 'state.json');
    await writeFile(`${statePath}.lock`, `pid ${await deadPid()}\n`);

    assert.equal(await withStateLock(statePath, async () => 'done'), 'done');
    await assert.rejects(() => stat(`${statePath}.lock`));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('withStateLock refuses a lock it cannot read a pid out of', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gtm-as-code-lock-'));
  try {
    const statePath = join(dir, 'state.json');
    await writeFile(`${statePath}.lock`, 'held by something else\n');

    await assert.rejects(() => withStateLock(statePath, async () => 'should not run'), StateLockedError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/** The pid of a process that has already exited, so `process.kill(pid, 0)` reports ESRCH. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', '']);
  const pid = child.pid;
  assert.ok(pid);
  await new Promise((resolve) => child.on('exit', resolve));
  return pid;
}

/** `withStateLock` acquires the lock via real filesystem I/O, so a caller needs to wait for it rather than assume one event-loop tick is enough. */
async function waitForFile(path: string): Promise<void> {
  for (;;) {
    try {
      await stat(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}

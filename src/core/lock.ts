import { open, readFile, unlink } from 'node:fs/promises';

/** Another `apply` already holds the lock on this state file. */
export class StateLockedError extends Error {
  constructor(lockPath: string, pid?: number) {
    super(
      `Another \`apply\` appears to be running against this state file (lock: ${lockPath}` +
        `${pid !== undefined ? `, pid ${pid}` : ''}). ` +
        'If no apply is actually running — e.g. the lock was left by a run on another machine — delete the lock file and retry.',
    );
    this.name = 'StateLockedError';
  }
}

/**
 * Runs `fn` while holding an exclusive lock next to `statePath`, so two concurrent `apply` runs
 * against the same state file can't interleave writes. The lock is a plain file created with the
 * `wx` flag (fails if it already exists), which is atomic on every filesystem this tool targets.
 *
 * A run killed outright (SIGKILL, a reaped CI step) skips the cleanup below, so an existing lock is
 * checked against its recorded pid: if that process is gone the lock is stale and taken over once.
 * A pid only means something on the machine that wrote it, so a lock from another host is left
 * alone and reported.
 */
export async function withStateLock<T>(statePath: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = `${statePath}.lock`;
  try {
    await acquire(lockPath);
  } catch (error) {
    if (!isEexist(error)) throw error;
    const pid = await readLockPid(lockPath);
    if (pid === undefined || isRunning(pid)) throw new StateLockedError(lockPath, pid);
    // Stale: the process that wrote it is gone. One retry only, so two runs racing here can't
    // both decide the other's lock is stale.
    await unlink(lockPath).catch(() => {});
    try {
      await acquire(lockPath);
    } catch (retryError) {
      if (isEexist(retryError)) throw new StateLockedError(lockPath);
      throw retryError;
    }
  }

  try {
    return await fn();
  } finally {
    await unlink(lockPath).catch(() => {});
  }
}

async function acquire(lockPath: string): Promise<void> {
  const handle = await open(lockPath, 'wx');
  await handle.writeFile(`pid ${process.pid}\n`);
  await handle.close();
}

/** `undefined` when the lock file holds anything other than the `pid <n>` line `acquire` writes. */
async function readLockPid(lockPath: string): Promise<number | undefined> {
  try {
    const contents = await readFile(lockPath, 'utf8');
    const pid = Number(/^pid (\d+)$/m.exec(contents)?.[1]);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists and belongs to someone else, which still counts as running.
    return isEperm(error);
  }
}

function isEexist(error: unknown): boolean {
  return errorCode(error) === 'EEXIST';
}

function isEperm(error: unknown): boolean {
  return errorCode(error) === 'EPERM';
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? (error as { code: unknown }).code : undefined;
}

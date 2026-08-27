import { open, unlink } from 'node:fs/promises';

/** Another `apply` already holds the lock on this state file. */
export class StateLockedError extends Error {
  constructor(lockPath: string) {
    super(
      `Another \`apply\` appears to be running against this state file (lock: ${lockPath}). ` +
        'If no apply is actually running — e.g. a previous run crashed — delete the lock file and retry.',
    );
    this.name = 'StateLockedError';
  }
}

/**
 * Runs `fn` while holding an exclusive lock next to `statePath`, so two concurrent `apply` runs
 * against the same state file can't interleave writes. The lock is a plain file created with the
 * `wx` flag (fails if it already exists), which is atomic on every filesystem this tool targets.
 */
export async function withStateLock<T>(statePath: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = `${statePath}.lock`;
  try {
    const handle = await open(lockPath, 'wx');
    await handle.writeFile(`pid ${process.pid}\n`);
    await handle.close();
  } catch (error) {
    if (isEexist(error)) throw new StateLockedError(lockPath);
    throw error;
  }

  try {
    return await fn();
  } finally {
    await unlink(lockPath).catch(() => {});
  }
}

function isEexist(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'EEXIST';
}

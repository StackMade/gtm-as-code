import assert from 'node:assert/strict';
import test from 'node:test';
import { confirm } from './confirm.js';

/** `process.stdin.isTTY` is `undefined` in a pipe; asserting on that is the whole point here. */
function withStdinTty<T>(isTTY: boolean | undefined, fn: () => T): T {
  const stdin = process.stdin as { isTTY?: boolean };
  const original = stdin.isTTY;
  stdin.isTTY = isTTY;
  try {
    return fn();
  } finally {
    stdin.isTTY = original;
  }
}

test('declines without prompting when stdin is not a TTY', async () => {
  const logged: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => void logged.push(String(message));
  try {
    const answered = await withStdinTty(undefined, () => confirm());
    assert.equal(answered, false);
  } finally {
    console.log = originalLog;
  }
  assert.match(logged.join('\n'), /--auto-approve/);
});

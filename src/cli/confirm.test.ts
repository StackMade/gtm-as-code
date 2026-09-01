import assert from 'node:assert/strict';
import test from 'node:test';
import { confirm, NEEDS_TERMINAL_HINT } from './confirm.js';

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

test('names no flag when the calling command has none', async () => {
  const logged: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => void logged.push(String(message));
  try {
    const answered = await withStdinTty(undefined, () => confirm(NEEDS_TERMINAL_HINT));
    assert.equal(answered, false);
  } finally {
    console.log = originalLog;
  }
  const output = logged.join('\n');
  assert.doesNotMatch(output, /--auto-approve/);
  assert.match(output, /only runs interactively/);
});

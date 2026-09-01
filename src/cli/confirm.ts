import { createInterface } from 'node:readline/promises';

/** What to tell the operator when there is no terminal: `apply`/`rollback` have a flag for it. */
export const AUTO_APPROVE_HINT = 'Pass --auto-approve to run without one.';

/** `adopt` has no such flag, so pointing at one would send the operator looking for it in vain. */
export const NEEDS_TERMINAL_HINT = 'This command only runs interactively.';

/**
 * Prompts `Continue? [y/N]` on stdin/stdout. Shared by any command that needs a destructive-action
 * confirmation. Declines immediately when stdin is not a TTY: readline's `question()` never settles
 * on a stream that will not send a line, so without this check a scripted run hangs until the event
 * loop drains and Node reports "Detected unsettled top-level await" instead of the missing flag.
 */
export async function confirm(hint: string = AUTO_APPROVE_HINT): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.log(`stdin is not interactive, so there is nothing to answer the prompt. ${hint}`);
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('Continue? [y/N] ');
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

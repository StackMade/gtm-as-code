import { createInterface } from 'node:readline/promises';

/**
 * Prompts `Continue? [y/N]` on stdin/stdout. Shared by any command that needs a destructive-action
 * confirmation. Declines immediately when stdin is not a TTY: readline's `question()` never settles
 * on a stream that will not send a line, so without this check a scripted run hangs until the event
 * loop drains and Node reports "Detected unsettled top-level await" instead of the missing flag.
 */
export async function confirm(prompt = 'Continue? [y/N] '): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.log('stdin is not interactive, so there is nothing to answer the prompt. Pass --auto-approve to run without one.');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(prompt);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

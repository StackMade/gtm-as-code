import { createInterface } from 'node:readline/promises';

/** Prompts `Continue? [y/N]` on stdin/stdout. Shared by any command that needs a destructive-action confirmation. */
export async function confirm(prompt = 'Continue? [y/N] '): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(prompt);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

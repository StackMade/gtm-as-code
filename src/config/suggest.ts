function levenshtein(a: string, b: string): number {
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[b.length];
}

/** Nearest candidate to `target` within `maxDistance` edits — used for "Did you mean" hints. */
export function closestMatch(
  target: string,
  candidates: readonly string[],
  maxDistance = 2,
): string | undefined {
  let best: { name: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = levenshtein(target, candidate);
    if (distance <= maxDistance && (!best || distance < best.distance)) {
      best = { name: candidate, distance };
    }
  }
  return best?.name;
}

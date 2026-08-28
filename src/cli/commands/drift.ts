import { computePlan, buildPlanJson, buildPlanMarkdown } from './plan.js';
import { SCOPES } from '../../providers/google/auth/index.js';
import { printFailure } from '../failure.js';
import type { GlobalOptions } from '../options.js';

/**
 * Read-only, scheduled-CI counterpart to `plan`: same comparison (live state vs. config,
 * readonly scopes), different purpose — "did anything drift, yes or no" for a cron job to
 * alert on, not a detailed plan for a human to review before an apply. Because of that,
 * the exit code contract is deliberately simpler than `plan`'s 0/1/2: `0` no drift,
 * `1` drift found OR an error, matching the roadmap's "non-zero exit on divergence".
 */
export async function drift(opts: GlobalOptions): Promise<void> {
  try {
    const result = await computePlan(opts, [SCOPES.gtmReadonly, SCOPES.ga4Readonly]);

    if (opts.format === 'json') console.log(JSON.stringify(buildPlanJson(result), null, 2));
    else if (opts.format === 'markdown') console.log(buildPlanMarkdown(result));
    else if (result.changes.length === 0) console.log('No drift.');
    else console.log(`Drift detected:\n\n${buildPlanMarkdown(result)}`);

    if (result.changes.length > 0) process.exitCode = 1;
  } catch (error) {
    printFailure(error);
    process.exitCode = 1;
  }
}

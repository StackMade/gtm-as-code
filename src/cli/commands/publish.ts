import { execFileSync } from 'node:child_process';
import { loadConfig } from '../../config/loader.js';
import { interpolateConfig } from '../../config/interpolation.js';
import { validateConfig } from '../../config/schema.js';
import { authorize, SCOPES } from '../../providers/google/auth/index.js';
import { GtmClient, resolveWorkspaceId } from '../../providers/google/gtm/client.js';
import { printFailure } from '../failure.js';
import type { GlobalOptions } from '../options.js';

/** Creates a container version from the current workspace and publishes it, making `apply`'s changes live. */
export async function publish(opts: GlobalOptions): Promise<void> {
  try {
    const parsed = loadConfig(opts.config);
    const interpolated = { ...parsed, data: interpolateConfig(parsed) };
    const config = validateConfig(interpolated);

    const auth = await authorize([SCOPES.gtmPublish, SCOPES.gtmReadonly]);
    const workspaceId = await resolveWorkspaceId(
      auth,
      config.google.gtm.accountId,
      config.google.gtm.containerId,
      config.google.gtm.workspace,
    );
    const gtm = new GtmClient(auth, { accountId: config.google.gtm.accountId, containerId: config.google.gtm.containerId, workspaceId });

    const { name, notes } = describeCommit();
    const version = await gtm.createVersion(name, notes);
    await gtm.publishVersion(version.containerVersionId);

    console.log(`Published container version ${version.containerVersionId}${version.name ? ` (${version.name})` : ''}.`);
  } catch (error) {
    printFailure(error);
    process.exitCode = 1;
  }
}

/** Names the version after the current commit when running inside a git checkout, otherwise a generic name. */
function describeCommit(): { name: string; notes: string } {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const subject = execFileSync('git', ['log', '-1', '--pretty=%s'], { encoding: 'utf8' }).trim();
    return { name: `${sha} ${subject}`.trim(), notes: `Published by gtm-code from commit ${sha}.` };
  } catch {
    return { name: 'gtm-code publish', notes: 'Published by gtm-code.' };
  }
}

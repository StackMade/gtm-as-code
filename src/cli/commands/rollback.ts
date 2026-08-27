import { loadConfig } from '../../config/loader.js';
import { interpolateConfig } from '../../config/interpolation.js';
import { validateConfig } from '../../config/schema.js';
import { authorize, SCOPES } from '../../providers/google/auth/index.js';
import { GtmClient, resolveWorkspaceId, type GtmVersionRef } from '../../providers/google/gtm/client.js';
import { confirm } from '../confirm.js';
import { printFailure } from '../failure.js';
import type { GlobalOptions } from '../options.js';

/** Republishes the container version that was live immediately before the current one. */
export async function rollback(opts: GlobalOptions & { autoApprove?: boolean }): Promise<void> {
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

    const live = await gtm.liveVersion();
    if (!live) {
      console.log('Nothing published yet — no version to roll back from.');
      return;
    }

    const previous = await findPreviousVersion(gtm, live);
    if (!previous) {
      console.log(`Version ${live.containerVersionId} is already the oldest published version.`);
      return;
    }

    console.log(`Currently live: ${describeVersion(live)}`);
    console.log(`Rolling back to: ${describeVersion(previous)}\n`);

    if (!opts.autoApprove && !(await confirm())) {
      console.log('Cancelled.');
      return;
    }

    await gtm.publishVersion(previous.containerVersionId);
    console.log(`Published version ${previous.containerVersionId}. It is now live.`);
  } catch (error) {
    printFailure(error);
    process.exitCode = 1;
  }
}

/** The highest-numbered version older than `live` — GTM assigns version ids as increasing integers. */
async function findPreviousVersion(gtm: GtmClient, live: GtmVersionRef): Promise<GtmVersionRef | null> {
  const liveNumber = Number(live.containerVersionId);
  const candidates = (await gtm.listVersions())
    .filter((version) => version.containerVersionId !== live.containerVersionId)
    .map((version) => ({ version, number: Number(version.containerVersionId) }))
    .filter(({ number }) => Number.isFinite(number) && number < liveNumber)
    .sort((a, b) => b.number - a.number);
  return candidates[0]?.version ?? null;
}

function describeVersion(version: GtmVersionRef): string {
  return version.name ? `${version.containerVersionId} (${version.name})` : version.containerVersionId;
}

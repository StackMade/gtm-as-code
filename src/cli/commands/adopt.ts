import { join } from 'node:path';
import { confirm, NEEDS_TERMINAL_HINT } from '../confirm.js';
import { loadConfig } from '../../config/loader.js';
import { interpolateConfig } from '../../config/interpolation.js';
import { validateConfig, type AnalyticsConfig } from '../../config/schema.js';
import { authorize, SCOPES } from '../../providers/google/auth/index.js';
import { GtmClient, resolveWorkspaceId, gtmIdField, type GtmKind, type GtmObject } from '../../providers/google/gtm/client.js';
import { Ga4Client, type Ga4Kind } from '../../providers/google/ga4/client.js';
import { resolveGa4Stream } from '../../providers/google/ga4/settings.js';
import { readState, recordManaged, writeState } from '../../core/state.js';
import { printFailure } from '../failure.js';
import { GA4_STREAM_SCOPED_KINDS } from './plan.js';
import { parseResourceArg, assignIds } from './pull.js';
import type { GlobalOptions } from '../options.js';

/**
 * Stamps ownership on a resource `pull` already brought into the config, so `plan`/`apply`
 * recognize it as managed. Deliberately separate from `pull` (which is read-only by design):
 * this is the one command in the adoption flow that writes — a GTM `notes` update (no functional
 * change to the object) or a `.analytics/state.json` entry for GA4.
 */
export async function adopt(resourceArg: string, opts: GlobalOptions): Promise<void> {
  try {
    const { kind, id } = parseResourceArg(resourceArg);
    const parsed = loadConfig(opts.config, opts.env);
    const config = validateConfig({ ...parsed, data: interpolateConfig(parsed) });

    if (kind === 'folder' || kind === 'variable' || kind === 'trigger' || kind === 'tag' || kind === 'environment')
      await adoptGtm(kind, id, config);
    else await adoptGa4(kind, id, config);
  } catch (error) {
    printFailure(error);
    process.exitCode = 1;
  }
}

/** Finds the remote GTM object matching a logical id the way `pull` assigned it (slugified `name`, in list order). */
export function findGtmMatch(objects: GtmObject[], kind: GtmKind, id: string): { object: GtmObject; gtmId: string } | null {
  const index = assignIds(objects).indexOf(id);
  if (index === -1) return null;
  const object = objects[index];
  const gtmId = object[gtmIdField(kind)];
  if (typeof gtmId !== 'string') return null;
  return { object, gtmId };
}

async function adoptGtm(kind: GtmKind, id: string, config: AnalyticsConfig): Promise<void> {
  const auth = await authorize([SCOPES.gtmEdit]);
  const workspaceId = await resolveWorkspaceId(
    auth,
    config.google.gtm.accountId,
    config.google.gtm.containerId,
    config.google.gtm.workspace,
  );
  const gtm = new GtmClient(auth, { accountId: config.google.gtm.accountId, containerId: config.google.gtm.containerId, workspaceId });

  const objects = await gtm.list(kind);
  const match = findGtmMatch(objects, kind, id);
  if (!match) {
    throw new Error(`No remote ${kind} found matching "${id}" (checked ${objects.length} ${kind}s by slugified name — did the container change since \`pull\`?)`);
  }

  console.log(`About to stamp ownership on GTM ${kind} "${String(match.object.name)}" (id ${match.gtmId}) as "${id}".`);
  console.log("This writes to the live container's notes field only — no functional change to the object.\n");
  if (!(await confirm(NEEDS_TERMINAL_HINT))) {
    console.log('Cancelled.');
    return;
  }

  // Re-submit the exact object just fetched: `update()` stamps ownership into `notes`,
  // everything else stays byte-for-byte what the container already had.
  await gtm.update(kind, id, match.gtmId, match.object);
  console.log(`Adopted. \`gtm-code plan\` should now recognize "${id}" as managed.`);
}

/**
 * Finds the resource name of the live GA4 object to record. A stream-scoped kind is looked up only
 * on `ga4.streamWebsiteUrl`'s stream, never a guessed one: `plan` reads that stream alone, so an
 * object adopted from any other would be recorded and then never seen.
 */
export async function findGa4Match(ga4: Ga4Client, kind: Ga4Kind, id: string, streamWebsiteUrl?: string): Promise<string> {
  let streamName: string | undefined;
  if (GA4_STREAM_SCOPED_KINDS.has(kind)) {
    if (!streamWebsiteUrl) {
      throw new Error(`A ${kind} belongs to a data stream. Set ga4.streamWebsiteUrl in the config to that stream's URL, then run adopt again.`);
    }
    streamName = (await resolveGa4Stream(ga4, streamWebsiteUrl)).name;
  }

  const resources = await ga4.listResources(kind, streamName);
  const match = resources.find((resource) => resource.id === id);
  const name = match ? (match.desiredState as { name?: string }).name : undefined;
  if (!name) {
    throw new Error(`No remote ${kind} found matching "${id}" (checked ${resources.length} ${kind}s)`);
  }
  return name;
}

async function adoptGa4(kind: Ga4Kind, id: string, config: AnalyticsConfig): Promise<void> {
  const auth = await authorize([SCOPES.ga4Readonly]);
  const ga4 = new Ga4Client(auth, config.google.ga4.propertyId);
  const name = await findGa4Match(ga4, kind, id, config.ga4.streamWebsiteUrl);

  console.log(`About to record "${id}" (${name}) as managed in .analytics/state.json.\n`);
  if (!(await confirm(NEEDS_TERMINAL_HINT))) {
    console.log('Cancelled.');
    return;
  }

  const statePath = join(process.cwd(), '.analytics', 'state.json');
  const state = recordManaged(await readState(statePath), ga4.stateKeyFor(kind, id), name);
  await writeState(statePath, state);
  console.log(`Adopted. \`gtm-code plan\` should now recognize "${id}" as managed.`);
}

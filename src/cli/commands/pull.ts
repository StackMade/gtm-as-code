import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { stringify } from 'yaml';
import { loadConfig, resolveConfigPath } from '../../config/loader.js';
import { interpolateConfig } from '../../config/interpolation.js';
import { validateConfig, type AnalyticsConfig } from '../../config/schema.js';
import { authorize, SCOPES } from '../../providers/google/auth/index.js';
import { GtmClient, resolveWorkspaceId, type GtmKind, type GtmObject } from '../../providers/google/gtm/client.js';
import { fromGtmPayload } from '../../providers/google/gtm/mapping.js';
import { parseContainerExport, resourcesFromExport } from '../../providers/google/gtm/export-import.js';
import { Ga4Client, type Ga4Kind } from '../../providers/google/ga4/client.js';
import { fromGa4Payload } from '../../providers/google/ga4/mapping.js';
import { printFailure } from '../failure.js';
import type { GlobalOptions } from '../options.js';

export interface PullOptions extends GlobalOptions {
  resource?: string;
  out?: string;
  /** Read GTM's UI-exported container JSON instead of calling the API — permission-free, GTM only (no GA4). */
  fromExport?: string;
}

export type PullKind =
  | 'folder'
  | 'variable'
  | 'trigger'
  | 'tag'
  | 'dimension'
  | 'metric'
  | 'keyEvent'
  | 'audience'
  | 'eventCreateRule'
  | 'eventEditRule';

const GTM_KINDS: GtmKind[] = ['folder', 'variable', 'trigger', 'tag'];
const GA4_KINDS: Ga4Kind[] = ['dimension', 'metric', 'keyEvent', 'audience'];

/** Where a pulled resource of each kind lands in `AnalyticsConfig`. */
const BUCKET: Record<PullKind, [top: 'gtm' | 'ga4', field: string]> = {
  folder: ['gtm', 'folders'],
  variable: ['gtm', 'variables'],
  trigger: ['gtm', 'triggers'],
  tag: ['gtm', 'tags'],
  dimension: ['ga4', 'dimensions'],
  metric: ['ga4', 'metrics'],
  keyEvent: ['ga4', 'keyEvents'],
  audience: ['ga4', 'audiences'],
  eventCreateRule: ['ga4', 'eventCreateRules'],
  eventEditRule: ['ga4', 'eventEditRules'],
};

const KIND_LABEL: Record<PullKind, string> = {
  folder: 'folders',
  variable: 'variables',
  trigger: 'triggers',
  tag: 'tags',
  dimension: 'custom dimensions',
  metric: 'custom metrics',
  keyEvent: 'key events',
  audience: 'audiences',
  eventCreateRule: 'event create rules',
  eventEditRule: 'event edit rules',
};

export async function pull(opts: PullOptions): Promise<void> {
  try {
    if (opts.resource && opts.fromExport) {
      throw new Error('--resource and --from-export cannot be combined yet. Run --from-export into a full config first, then --resource against the live API.');
    }
    if (opts.fromExport) await pullFromExport(opts);
    else if (opts.resource) await pullOne(opts);
    else await pullAll(opts);
  } catch (error) {
    printFailure(error);
    process.exitCode = 1;
  }
}

/**
 * Permission-free adoption path: reads a GTM UI container export (Admin -> Export Container)
 * instead of calling the API. GTM only — GA4 has no export-file equivalent, so the existing
 * `ga4:` section of the config (if any) is left untouched.
 */
async function pullFromExport(opts: PullOptions): Promise<void> {
  const configPath = resolveConfigPath(opts.config);
  const parsed = loadConfig(opts.config);
  const raw = parsed.data as Record<string, unknown>;

  const outPath = opts.out ? resolve(process.cwd(), opts.out) : configPath;
  if (existsSync(outPath) && !(await confirmOverwrite(outPath))) {
    console.log('Aborted. Existing configuration left untouched.');
    return;
  }

  const exportPath = resolve(process.cwd(), opts.fromExport!);
  const json: unknown = JSON.parse(readFileSync(exportPath, 'utf8'));
  const container = parseContainerExport(json);
  const resources = resourcesFromExport(container) as {
    folders: Record<string, unknown>;
    variables: Record<string, unknown>;
    triggers: Record<string, unknown>;
    tags: Record<string, unknown>;
    skipped: number;
  };

  const existingGa4 = (raw.ga4 ?? {
    dimensions: {},
    metrics: {},
    keyEvents: {},
    audiences: {},
    eventCreateRules: {},
    eventEditRules: {},
  }) as Record<string, unknown>;
  const nextConfig = {
    ...raw,
    gtm: { folders: resources.folders, variables: resources.variables, triggers: resources.triggers, tags: resources.tags },
    ga4: existingGa4,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, stringify(nextConfig), 'utf8');

  const counts: FoundCounts = {
    folders: container.folder.length,
    variables: container.variable.length,
    triggers: container.trigger.length,
    tags: container.tag.length,
    dimensions: 0,
    metrics: 0,
    keyEvents: 0,
    audiences: 0,
    eventCreateRules: 0,
    eventEditRules: 0,
    skipped: resources.skipped,
  };
  console.log(buildFoundSummary(counts).join('\n'));
  console.log('');
  console.log('Generated:\n');
  console.log(`  ${outPath}`);
}

async function pullAll(opts: PullOptions): Promise<void> {
  const configPath = resolveConfigPath(opts.config);
  const parsed = loadConfig(opts.config);
  // The validated/interpolated config is only used to connect (resolved accountId etc.) —
  // the file we write is built from the raw parsed data, so `${GTM_ACCOUNT_ID}`-style
  // placeholders are never replaced with their resolved values on disk.
  const config = validateConfig({ ...parsed, data: interpolateConfig(parsed) });

  const outPath = opts.out ? resolve(process.cwd(), opts.out) : configPath;
  if (existsSync(outPath) && !(await confirmOverwrite(outPath))) {
    console.log('Aborted. Existing configuration left untouched.');
    return;
  }

  const { gtm, ga4 } = await connect(config);
  const { gtmResources, ga4Resources, counts } = await pullAllResources(gtm, ga4);

  const raw = parsed.data as Record<string, unknown>;
  const nextConfig = {
    ...raw,
    gtm: { folders: gtmResources.folder, variables: gtmResources.variable, triggers: gtmResources.trigger, tags: gtmResources.tag },
    ga4: {
      dimensions: ga4Resources.dimension,
      metrics: ga4Resources.metric,
      keyEvents: ga4Resources.keyEvent,
      audiences: ga4Resources.audience,
      eventCreateRules: ga4Resources.eventCreateRule,
      eventEditRules: ga4Resources.eventEditRule,
      ...(config.ga4.streamWebsiteUrl ? { streamWebsiteUrl: config.ga4.streamWebsiteUrl } : {}),
    },
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, stringify(nextConfig), 'utf8');

  console.log(buildFoundSummary(counts).join('\n'));
  console.log('');
  console.log('Generated:\n');
  console.log(`  ${outPath}`);
}

async function pullOne(opts: PullOptions): Promise<void> {
  const { kind, id } = parseResourceArg(opts.resource!);

  const configPath = resolveConfigPath(opts.config);
  const parsed = loadConfig(opts.config);
  const config = validateConfig({ ...parsed, data: interpolateConfig(parsed) });

  const { gtm, ga4 } = await connect(config);
  const { gtmResources, ga4Resources } = await pullAllResources(gtm, ga4);

  const desiredState =
    kind === 'folder' || kind === 'variable' || kind === 'trigger' || kind === 'tag'
      ? gtmResources[kind][id]
      : ga4Resources[kind][id];

  if (!desiredState) {
    throw new Error(`No remote ${kind} found with id "${id}"`);
  }

  // Merged into the raw parsed data, not the validated/interpolated config, so any
  // `${VAR}` placeholders elsewhere in the file are written back untouched.
  const nextConfig = mergeResourceIntoConfig(parsed.data as Record<string, unknown>, kind, id, desiredState);

  writeFileSync(configPath, stringify(nextConfig), 'utf8');

  console.log(`Found:\n\n  1 ${KIND_LABEL[kind].replace(/s$/, '')}`);
  console.log('');
  console.log(`Updated:\n\n  ${configPath}`);
}

async function connect(config: AnalyticsConfig): Promise<{ gtm: GtmClient; ga4: Ga4Client }> {
  const auth = await authorize([SCOPES.gtmReadonly, SCOPES.ga4Readonly]);
  const workspaceId = await resolveWorkspaceId(
    auth,
    config.google.gtm.accountId,
    config.google.gtm.containerId,
    config.google.gtm.workspace,
  );
  const gtm = new GtmClient(auth, {
    accountId: config.google.gtm.accountId,
    containerId: config.google.gtm.containerId,
    workspaceId,
  });
  const ga4 = new Ga4Client(auth, config.google.ga4.propertyId);
  return { gtm, ga4 };
}

interface PulledGtm {
  folder: Record<string, Record<string, unknown>>;
  variable: Record<string, Record<string, unknown>>;
  trigger: Record<string, Record<string, unknown>>;
  tag: Record<string, Record<string, unknown>>;
}

interface PulledGa4 {
  dimension: Record<string, Record<string, unknown>>;
  metric: Record<string, Record<string, unknown>>;
  keyEvent: Record<string, Record<string, unknown>>;
  audience: Record<string, Record<string, unknown>>;
  eventCreateRule: Record<string, Record<string, unknown>>;
  eventEditRule: Record<string, Record<string, unknown>>;
}

export interface FoundCounts {
  folders: number;
  variables: number;
  triggers: number;
  tags: number;
  dimensions: number;
  metrics: number;
  keyEvents: number;
  audiences: number;
  eventCreateRules: number;
  eventEditRules: number;
  /** GTM objects with no reverse mapping (e.g. built-in types this tool doesn't manage) — found but not written. */
  skipped: number;
}

async function pullAllResources(
  gtm: GtmClient,
  ga4: Ga4Client,
): Promise<{ gtmResources: PulledGtm; ga4Resources: PulledGa4; counts: FoundCounts }> {
  const [folders, variables, triggers, tags] = await Promise.all(GTM_KINDS.map((kind) => gtm.list(kind)));

  const folderGtmIdToLogicalId: Record<string, string> = {};
  const folderIds = assignIds(folders as GtmObject[]);
  folders.forEach((object, index) => {
    const gtmId = (object as GtmObject).folderId;
    if (typeof gtmId === 'string') folderGtmIdToLogicalId[gtmId] = folderIds[index];
  });

  const triggerGtmIdToLogicalId: Record<string, string> = {};
  const triggerIds = assignIds(triggers as GtmObject[]);
  triggers.forEach((object, index) => {
    const gtmId = (object as GtmObject).triggerId;
    if (typeof gtmId === 'string') triggerGtmIdToLogicalId[gtmId] = triggerIds[index];
  });

  const context = { triggerGtmIdToLogicalId, folderGtmIdToLogicalId };
  const folderMap = toGtmMap('folder', folders as GtmObject[], folderIds, context);
  const variableMap = toGtmMap('variable', variables as GtmObject[], assignIds(variables as GtmObject[]), context);
  const triggerMap = toGtmMap('trigger', triggers as GtmObject[], triggerIds, context);
  const tagMap = toGtmMap('tag', tags as GtmObject[], assignIds(tags as GtmObject[]), context);

  const gtmResources: PulledGtm = {
    folder: folderMap.resources,
    variable: variableMap.resources,
    trigger: triggerMap.resources,
    tag: tagMap.resources,
  };

  const [dimensions, metrics, keyEvents, audiences] = await Promise.all(GA4_KINDS.map((kind) => ga4.listResources(kind)));

  // Event create/edit rules are stream-scoped; pull has no config-declared stream to work from,
  // so it only pulls them when the property has exactly one web data stream to resolve to.
  // Multiple streams would need picking one, which isn't a decision pull can make silently.
  const dataStreams = await ga4.listDataStreams();
  const webStreams = dataStreams.filter((s) => s.type === 'WEB_DATA_STREAM');
  const [eventCreateRules, eventEditRules] =
    webStreams.length === 1
      ? await Promise.all([
          ga4.listResources('eventCreateRule', webStreams[0].name),
          ga4.listResources('eventEditRule', webStreams[0].name),
        ])
      : [[], []];
  if (webStreams.length > 1) {
    console.log(`Skipping event create/edit rules: ${webStreams.length} web data streams found, pull only supports a single stream.`);
  }

  const ga4Resources: PulledGa4 = {
    dimension: toGa4Map('dimension', dimensions),
    metric: toGa4Map('metric', metrics),
    keyEvent: toGa4Map('keyEvent', keyEvents),
    audience: toGa4Map('audience', audiences),
    eventCreateRule: toGa4Map('eventCreateRule', eventCreateRules),
    eventEditRule: toGa4Map('eventEditRule', eventEditRules),
  };

  // "Found" counts the raw remote objects GTM returned, not just the ones this tool knows
  // how to reverse-map — otherwise an unmapped built-in type would look like a wrong container.
  const counts: FoundCounts = {
    folders: folders.length,
    variables: variables.length,
    triggers: triggers.length,
    tags: tags.length,
    dimensions: Object.keys(ga4Resources.dimension).length,
    metrics: Object.keys(ga4Resources.metric).length,
    keyEvents: Object.keys(ga4Resources.keyEvent).length,
    audiences: Object.keys(ga4Resources.audience).length,
    eventCreateRules: Object.keys(ga4Resources.eventCreateRule).length,
    eventEditRules: Object.keys(ga4Resources.eventEditRule).length,
    skipped: folderMap.skipped + variableMap.skipped + triggerMap.skipped + tagMap.skipped,
  };

  return { gtmResources, ga4Resources, counts };
}

function toGtmMap(
  kind: GtmKind,
  objects: GtmObject[],
  ids: string[],
  context: { triggerGtmIdToLogicalId: Record<string, string>; folderGtmIdToLogicalId: Record<string, string> },
): { resources: Record<string, Record<string, unknown>>; skipped: number } {
  const resources: Record<string, Record<string, unknown>> = {};
  let skipped = 0;
  objects.forEach((object, index) => {
    try {
      resources[ids[index]] = fromGtmPayload(kind, object, context);
    } catch {
      // No reverse mapping for this GTM object type (e.g. a built-in variable/trigger
      // this tool doesn't manage) — skip it rather than fail the whole pull.
      skipped++;
    }
  });
  return { resources, skipped };
}

function toGa4Map(
  kind: Ga4Kind,
  resources: Array<{ id: string; desiredState: unknown }>,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const resource of resources) {
    result[resource.id] = fromGa4Payload(kind, resource.desiredState as Parameters<typeof fromGa4Payload>[1]);
  }
  return result;
}

/** Logical ids for a list of GTM objects: slugified `name`, deduped with `_2`, `_3`, ... on collision. */
export function assignIds(objects: Array<Record<string, unknown>>): string[] {
  const used = new Set<string>();
  return objects.map((object) => uniqueSlug(String(object.name ?? ''), used));
}

/** Lowercase, non `[a-z0-9_]` runs become `_`; leading/trailing `_` trimmed. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function uniqueSlug(name: string, used: Set<string>): string {
  const base = slugify(name) || 'unnamed';
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix++;
  }
  used.add(candidate);
  return candidate;
}

/** Parses `<kind>:<id>` for `--resource`, e.g. `tag:generate_lead_tag`. */
export function parseResourceArg(arg: string): { kind: PullKind; id: string } {
  const separator = arg.indexOf(':');
  if (separator === -1) {
    throw new Error(`Invalid --resource "${arg}". Expected <kind>:<id>, e.g. tag:generate_lead_tag`);
  }
  const kind = arg.slice(0, separator);
  const id = arg.slice(separator + 1);
  if (!id || !(kind in BUCKET)) {
    throw new Error(
      `Invalid --resource "${arg}". Kind must be one of: ${Object.keys(BUCKET).join(', ')}`,
    );
  }
  return { kind: kind as PullKind, id };
}

/** A "Found:" summary in PRD §13's style: one line per kind, in this fixed order. */
export function buildFoundSummary(counts: FoundCounts): string[] {
  const lines = [
    'Found:',
    '',
    `  ${counts.tags} tags`,
    `  ${counts.triggers} triggers`,
    `  ${counts.variables} variables`,
    `  ${counts.folders} folders`,
    `  ${counts.dimensions} custom dimensions`,
    `  ${counts.metrics} custom metrics`,
    `  ${counts.keyEvents} key events`,
    `  ${counts.audiences} audiences`,
    `  ${counts.eventCreateRules} event create rules`,
    `  ${counts.eventEditRules} event edit rules`,
  ];
  if (counts.skipped > 0) {
    lines.push('', `  ${counts.skipped} skipped (no reverse mapping for this GTM object type)`);
  }
  return lines;
}

/** Adds/replaces one resource's desired state in an existing (raw, pre-validation) config, leaving everything else untouched. */
export function mergeResourceIntoConfig(
  config: Record<string, unknown>,
  kind: PullKind,
  id: string,
  desiredState: Record<string, unknown>,
): Record<string, unknown> {
  const [top, field] = BUCKET[kind];
  const bucket = (config[top] ?? {}) as Record<string, Record<string, unknown>>;
  return {
    ...config,
    [top]: {
      ...bucket,
      [field]: { ...bucket[field], [id]: desiredState },
    },
  };
}

async function confirmOverwrite(path: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  output.write(`${path} already exists. Overwrite? [y/N] `);
  let answer = '';
  for await (const line of rl) {
    answer = line;
    break;
  }
  rl.close();
  return answer.trim().toLowerCase() === 'y';
}

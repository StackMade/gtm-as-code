import { loadConfig } from '../../config/loader.js';
import { interpolateConfig } from '../../config/interpolation.js';
import { validateConfig } from '../../config/schema.js';
import type { EventDef } from '../../config/schema.js';
import { compileEvents } from '../../core/compile.js';
import { authorize, SCOPES } from '../../providers/google/auth/index.js';
import { Ga4ApiError } from '../../providers/google/ga4/errors.js';
import { Ga4DataClient } from '../../providers/google/ga4/data-client.js';
import { printFailure } from '../failure.js';
import type { GlobalOptions } from '../options.js';

const DEFAULT_DAYS = 28;

export interface VerifyCommandOptions extends GlobalOptions {
  days?: string;
}

export type ParamStatus = 'present' | 'missing' | 'not-registered';

export interface EventVerifyResult {
  eventId: string;
  received: boolean;
  eventCount: number;
  /** Declared `dimension: true` parameters checked against GA4 and never seen with a value. */
  missingParameters: string[];
  /** Declared `dimension: true` parameters whose custom dimension doesn't exist on the property yet — run `apply` first. */
  notRegisteredParameters: string[];
  /** Declared parameters the Data API has no way to check: not registered as a custom dimension. */
  unverifiableParameters: string[];
}

export interface VerifyReport {
  days: number;
  events: EventVerifyResult[];
}

/**
 * The check the GTM UI cannot give: config can be perfect while the site never actually fires an
 * event, or fires it without a parameter the tracking plan declares. Queries the GA4 **Data** API
 * for what was actually received over the trailing `days`, read-only throughout.
 */
export async function verify(opts: VerifyCommandOptions): Promise<void> {
  try {
    const report = await computeVerifyReport(opts);
    render(report, opts.format);
    if (hasProblems(report)) process.exitCode = 1;
  } catch (error) {
    printFailure(error);
    process.exitCode = 1;
  }
}

export function hasProblems(report: VerifyReport): boolean {
  return report.events.some((e) => !e.received || e.missingParameters.length > 0);
}

/**
 * Pure classification given already-fetched data: `eventCount` from `Ga4DataClient.eventCounts`,
 * `paramStatuses` from `Ga4DataClient.hasParameterValue` (keyed by parameter name, only for
 * `dimension: true` parameters — that is the only kind the Data API can check). Split out from
 * `computeVerifyReport` so the classification logic is testable without a live GA4 property.
 */
export function classifyEvent(eventId: string, event: EventDef, eventCount: number, paramStatuses: Record<string, ParamStatus>): EventVerifyResult {
  const received = eventCount > 0;
  const missingParameters: string[] = [];
  const notRegisteredParameters: string[] = [];
  const unverifiableParameters: string[] = [];

  if (received) {
    for (const [paramName, param] of Object.entries(event.parameters)) {
      if (param.optional) continue;
      if (!param.dimension) {
        unverifiableParameters.push(paramName);
        continue;
      }
      const status = paramStatuses[paramName];
      if (status === 'missing') missingParameters.push(paramName);
      else if (status === 'not-registered') notRegisteredParameters.push(paramName);
    }
  }

  return { eventId, received, eventCount, missingParameters, notRegisteredParameters, unverifiableParameters };
}

export async function computeVerifyReport(opts: VerifyCommandOptions): Promise<VerifyReport> {
  const days = opts.days ? Number(opts.days) : DEFAULT_DAYS;
  const parsed = loadConfig(opts.config);
  const interpolated = { ...parsed, data: interpolateConfig(parsed) };
  const config = validateConfig(interpolated);
  const compiled = compileEvents(config, parsed.file);

  const auth = await authorize([SCOPES.ga4Readonly]);
  const data = new Ga4DataClient(auth, config.google.ga4.propertyId);
  const counts = await data.eventCounts(days);

  const events: EventVerifyResult[] = [];
  for (const [eventId, event] of Object.entries(config.events)) {
    const eventCount = counts.get(eventId) ?? 0;
    const paramStatuses: Record<string, ParamStatus> = {};

    if (eventCount > 0) {
      for (const [paramName, param] of Object.entries(event.parameters)) {
        if (param.optional || !param.dimension) continue;
        const dimensionParameter = compiled.ga4.dimensions[paramName]?.parameter ?? paramName;
        try {
          paramStatuses[paramName] = (await data.hasParameterValue(eventId, dimensionParameter, days)) ? 'present' : 'missing';
        } catch (error) {
          if (error instanceof Ga4ApiError && error.status === 'INVALID_ARGUMENT') paramStatuses[paramName] = 'not-registered';
          else throw error;
        }
      }
    }

    events.push(classifyEvent(eventId, event, eventCount, paramStatuses));
  }

  return { days, events };
}

function render(report: VerifyReport, format: GlobalOptions['format']): void {
  if (format === 'json') return console.log(JSON.stringify(report, null, 2));
  if (format === 'markdown') return console.log(renderMarkdown(report));
  renderText(report);
}

export function renderMarkdown(report: VerifyReport): string {
  if (!hasProblems(report)) return `**GTM as Code verify**: all declared events received in the last ${report.days} days.`;

  const lines = [`**GTM as Code verify** — last ${report.days} days`, ''];
  for (const event of report.events) {
    if (!event.received) lines.push(`- \`${event.eventId}\`: never received`);
    else if (event.missingParameters.length > 0) {
      lines.push(`- \`${event.eventId}\`: received, but never saw a value for ${event.missingParameters.map((p) => `\`${p}\``).join(', ')}`);
    }
  }
  return lines.join('\n');
}

function renderText(report: VerifyReport): void {
  console.log(`GTM as Code verify — last ${report.days} days\n`);

  for (const event of report.events) {
    if (event.received) console.log(`  ok  ${event.eventId} (${event.eventCount} events)`);
    else console.log(`  MISSING  ${event.eventId} — never received`);

    for (const param of event.missingParameters) console.log(`         MISSING PARAM  ${param} — never seen with a value`);
    for (const param of event.notRegisteredParameters) {
      console.log(
        `         not registered  ${param} — GA4 has no custom dimension for it. Run apply if it was never created; ` +
          'if apply just created it, the Data API takes a few minutes to pick it up.',
      );
    }
    for (const param of event.unverifiableParameters) console.log(`         unverifiable   ${param} — not a \`dimension: true\` parameter, GA4 can't be queried for it`);
  }

  if (!hasProblems(report)) console.log('\nAll declared events received.');
}

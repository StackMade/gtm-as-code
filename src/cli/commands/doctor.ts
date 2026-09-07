import { loadConfig } from '../../config/loader.js';
import { interpolateConfig } from '../../config/interpolation.js';
import { validateConfig } from '../../config/schema.js';
import { authorize, currentProjectId, describeAuthFailure, SCOPES } from '../../providers/google/auth/index.js';
import { resolveWorkspaceId } from '../../providers/google/gtm/client.js';
import { extractApiMessage } from '../../providers/google/gtm/errors.js';
import { Ga4Client } from '../../providers/google/ga4/client.js';
import { Ga4DataClient, type PropertyQuota } from '../../providers/google/ga4/data-client.js';
import type { GlobalOptions } from '../options.js';

/** Below this fraction of the daily token quota remaining, `doctor` warns instead of just reporting the number. */
const QUOTA_WARN_THRESHOLD = 0.1;

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail?: string;
}

/**
 * Checks credentials, API enablement, granted scopes, and GA4 Data API quota headroom, and
 * explains what's missing instead of `plan`/`apply`/`publish` failing mid-run with a raw Google
 * error. Each check is independent and best-effort: one failing (e.g. GA4 unreachable) doesn't
 * stop the rest from running, except the two upstream checks (config, credentials) nothing else
 * can work without.
 *
 * The write- and publish-scope checks matter on their own: `plan`/`drift` only need the readonly
 * scopes the credentials check already confirms, so a credential missing `gtmEditVersions` (the
 * exact gap `publish` hit live once, see the 2026-09-01 PoliczProsto defect notes) looks perfectly
 * healthy until the first `apply` or `publish` run. They're `warn`, not `fail` — a readonly-only
 * credential is a legitimate setup for a CI job that only ever runs `plan`/`drift`.
 */
export async function doctor(opts: GlobalOptions): Promise<void> {
  const checks = await runDoctorChecks(opts);
  render(checks, opts.format);
  if (checks.some((c) => c.status === 'fail')) process.exitCode = 1;
}

export async function runDoctorChecks(opts: GlobalOptions): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  let config;
  try {
    const parsed = loadConfig(opts.config, opts.env);
    const interpolated = { ...parsed, data: interpolateConfig(parsed) };
    config = validateConfig(interpolated);
    checks.push({ name: 'config', status: 'ok', detail: parsed.file });
  } catch (error) {
    checks.push({ name: 'config', status: 'fail', detail: error instanceof Error ? error.message : String(error) });
    return checks;
  }

  let auth;
  try {
    auth = await authorize([SCOPES.gtmReadonly, SCOPES.ga4Readonly]);
    const projectId = await currentProjectId();
    checks.push({ name: 'credentials', status: 'ok', detail: projectId ? `project ${projectId}` : undefined });
  } catch (error) {
    checks.push({ name: 'credentials', status: 'fail', detail: describeAuthFailure(error) });
    return checks;
  }

  try {
    await authorize([SCOPES.gtmEdit, SCOPES.ga4Edit]);
    checks.push({ name: 'write scopes (apply)', status: 'ok' });
  } catch (error) {
    checks.push({ name: 'write scopes (apply)', status: 'warn', detail: `apply will fail without them. ${describeAuthFailure(error)}` });
  }

  try {
    await authorize([SCOPES.gtmPublish, SCOPES.gtmEditVersions]);
    checks.push({ name: 'publish scopes (publish/rollback)', status: 'ok' });
  } catch (error) {
    checks.push({ name: 'publish scopes (publish/rollback)', status: 'warn', detail: `publish/rollback will fail without them. ${describeAuthFailure(error)}` });
  }

  try {
    await resolveWorkspaceId(auth, config.google.gtm.accountId, config.google.gtm.containerId, config.google.gtm.workspace);
    checks.push({ name: 'GTM API', status: 'ok' });
  } catch (error) {
    checks.push({ name: 'GTM API', status: 'fail', detail: classifyGoogleApiError(error) });
  }

  const ga4 = new Ga4Client(auth, config.google.ga4.propertyId);
  try {
    await ga4.getDataRetentionSettings();
    checks.push({ name: 'GA4 Admin API', status: 'ok' });
  } catch (error) {
    checks.push({ name: 'GA4 Admin API', status: 'fail', detail: classifyGoogleApiError(error) });
  }

  const data = new Ga4DataClient(auth, config.google.ga4.propertyId);
  try {
    checks.push(quotaCheck(await data.quota()));
  } catch (error) {
    checks.push({ name: 'GA4 Data API', status: 'fail', detail: classifyGoogleApiError(error) });
  }

  return checks;
}

/**
 * Google returns the same `PERMISSION_DENIED` status for "the API is disabled on this project"
 * and for "this account lacks access" — the two need different fixes, and only the full message
 * (not the short status `GtmApiError`/`Ga4ApiError` carry) tells them apart. `error.cause` is the
 * raw request error those wrapper classes were built from.
 */
export function classifyGoogleApiError(error: unknown): string {
  const raw = error instanceof Error && error.cause !== undefined ? error.cause : error;
  const message = extractApiMessage(raw);
  if (/has not been used in project|it is disabled/i.test(message)) return `API not enabled — enable it in Google Cloud Console. ${message}`;
  if (/permission/i.test(message)) return `Permission denied. ${message}`;
  return message;
}

export function quotaCheck(quota: PropertyQuota | undefined): DoctorCheck {
  const daily = quota?.tokensPerDay;
  if (!daily) return { name: 'GA4 Data API', status: 'ok', detail: 'reachable' };
  const total = daily.consumed + daily.remaining;
  const ratio = total > 0 ? daily.remaining / total : 1;
  const detail = `${daily.remaining} tokens/day remaining (of ${total})`;
  return ratio < QUOTA_WARN_THRESHOLD ? { name: 'GA4 Data API', status: 'warn', detail } : { name: 'GA4 Data API', status: 'ok', detail };
}

function render(checks: DoctorCheck[], format: GlobalOptions['format']): void {
  if (format === 'json') return console.log(JSON.stringify(checks, null, 2));
  if (format === 'markdown') return console.log(renderMarkdown(checks));
  renderText(checks);
}

export function renderMarkdown(checks: DoctorCheck[]): string {
  const lines = ['**GTM as Code doctor**', '', '| Check | Status | Detail |', '| --- | --- | --- |'];
  for (const check of checks) lines.push(`| ${check.name} | ${STATUS_SYMBOL[check.status]} ${check.status} | ${check.detail ?? ''} |`);
  return lines.join('\n');
}

const STATUS_SYMBOL: Record<CheckStatus, string> = { ok: '✓', warn: '⚠', fail: '✗' };

function renderText(checks: DoctorCheck[]): void {
  console.log('GTM as Code doctor\n');
  for (const check of checks) {
    console.log(`  ${STATUS_SYMBOL[check.status]} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
  }
}

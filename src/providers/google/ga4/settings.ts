import type { AnalyticsConfig } from '../../../config/schema.js';
import { Ga4Client, type DataStream } from './client.js';

export interface Ga4SettingsDiff {
  /** The resolved data stream's full resource path, set whenever `ga4.streamWebsiteUrl` is declared. */
  streamName?: string;
  dataRetention?: { patch: { eventDataRetention: string }; updateMask: string[] };
  googleSignals?: { patch: { state: string }; updateMask: string[] };
  attributionSettings?: { patch: Record<string, string>; updateMask: string[] };
  enhancedMeasurement?: { patch: Record<string, boolean>; updateMask: string[] };
}

/** Looks up `streamWebsiteUrl`'s data stream, naming the URLs that do exist if it's not found. */
export async function resolveGa4Stream(ga4: Ga4Client, streamWebsiteUrl: string): Promise<DataStream> {
  const stream = await ga4.findWebStreamByUrl(streamWebsiteUrl);
  if (!stream) {
    const streams = await ga4.listDataStreams();
    const known = streams.map((s) => s.webStreamData?.defaultUri).filter(Boolean);
    const knownList = known.length > 0 ? ` Web streams on this property: ${known.join(', ')}.` : ' This property has no web data streams.';
    throw new Error(`No GA4 web data stream found for URL "${streamWebsiteUrl}".${knownList}`);
  }
  return stream;
}

/**
 * Property/stream settings have no create-delete lifecycle, unlike dimensions/metrics/keyEvents,
 * so they're diffed here against live state rather than flowing through `core/diff.ts`'s
 * `Resource`/`Change` model. `resolvedStream`, when passed, skips this function's own lookup —
 * callers that also need the stream for something else (event create/edit rules) resolve it once.
 */
export async function diffGa4Settings(
  ga4: Ga4Client,
  config: AnalyticsConfig['ga4'],
  resolvedStream?: DataStream,
): Promise<Ga4SettingsDiff> {
  const result: Ga4SettingsDiff = {};

  if (config.dataRetention) {
    const current = await ga4.getDataRetentionSettings();
    if (current.eventDataRetention !== config.dataRetention) {
      result.dataRetention = { patch: { eventDataRetention: config.dataRetention }, updateMask: ['eventDataRetention'] };
    }
  }

  if (config.googleSignals) {
    const current = await ga4.getGoogleSignalsSettings();
    if (current.state !== config.googleSignals) {
      result.googleSignals = { patch: { state: config.googleSignals }, updateMask: ['state'] };
    }
  }

  if (config.attributionSettings) {
    const current = (await ga4.getAttributionSettings()) as unknown as Record<string, string>;
    const patch: Record<string, string> = {};
    const updateMask: string[] = [];
    for (const [key, value] of Object.entries(config.attributionSettings)) {
      if (current[key] !== value) {
        patch[key] = value;
        updateMask.push(key);
      }
    }
    if (updateMask.length > 0) result.attributionSettings = { patch, updateMask };
  }

  if (config.streamWebsiteUrl) {
    const stream = resolvedStream ?? (await resolveGa4Stream(ga4, config.streamWebsiteUrl));
    result.streamName = stream.name;

    if (config.enhancedMeasurement) {
      const current = (await ga4.getEnhancedMeasurementSettings(stream.name)) as Record<string, unknown>;
      const patch: Record<string, boolean> = {};
      const updateMask: string[] = [];
      for (const [key, value] of Object.entries(config.enhancedMeasurement)) {
        // proto3 JSON omits `false` fields entirely, so an unset key means false, not "unknown".
        if ((current[key] ?? false) !== value) {
          patch[key] = value as boolean;
          updateMask.push(key);
        }
      }
      if (updateMask.length > 0) result.enhancedMeasurement = { patch, updateMask };
    }
  }

  return result;
}

/** One field a settings PATCH asked for and the live object does not have afterwards. */
export interface Ga4SettingsMismatch {
  setting: string;
  field: string;
  requested: unknown;
  live: unknown;
}

/**
 * Reads the four settings objects back after `apply` PATCHed them and reports any field that did not
 * take. These settings have no create/delete lifecycle to fall back on, and GA4 answers some writes
 * with a `200` that changes nothing (`siteSearchEnabled` needs a `searchQueryParameter`, for one), so
 * without this check the only symptom is that the next `plan` shows the same update again. Only
 * fields the PATCH actually named are compared.
 */
export async function verifyGa4SettingsApplied(ga4: Ga4Client, diff: Ga4SettingsDiff): Promise<Ga4SettingsMismatch[]> {
  const mismatches: Ga4SettingsMismatch[] = [];

  const compare = (setting: string, patch: Record<string, unknown>, updateMask: string[], live: Record<string, unknown>, absentIs?: unknown) => {
    for (const field of updateMask) {
      const liveValue = live[field] ?? absentIs;
      if (liveValue !== patch[field]) mismatches.push({ setting, field, requested: patch[field], live: liveValue });
    }
  };

  if (diff.dataRetention) {
    const live = (await ga4.getDataRetentionSettings()) as unknown as Record<string, unknown>;
    compare('dataRetention', diff.dataRetention.patch, diff.dataRetention.updateMask, live);
  }
  if (diff.googleSignals) {
    const live = (await ga4.getGoogleSignalsSettings()) as unknown as Record<string, unknown>;
    compare('googleSignals', diff.googleSignals.patch, diff.googleSignals.updateMask, live);
  }
  if (diff.attributionSettings) {
    const live = (await ga4.getAttributionSettings()) as unknown as Record<string, unknown>;
    compare('attributionSettings', diff.attributionSettings.patch, diff.attributionSettings.updateMask, live);
  }
  if (diff.enhancedMeasurement && diff.streamName) {
    const live = (await ga4.getEnhancedMeasurementSettings(diff.streamName)) as unknown as Record<string, unknown>;
    // proto3 JSON omits `false`, same reason `diffGa4Settings` reads an absent key as `false`.
    compare('enhancedMeasurement', diff.enhancedMeasurement.patch, diff.enhancedMeasurement.updateMask, live, false);
  }

  return mismatches;
}

export function hasGa4SettingsChanges(diff: Ga4SettingsDiff): boolean {
  return (
    diff.dataRetention !== undefined ||
    diff.googleSignals !== undefined ||
    diff.attributionSettings !== undefined ||
    diff.enhancedMeasurement !== undefined
  );
}

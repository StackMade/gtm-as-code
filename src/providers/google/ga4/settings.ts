import type { AnalyticsConfig } from '../../../config/schema.js';
import { Ga4Client, type DataStream } from './client.js';

export interface Ga4SettingsDiff {
  /** The resolved data stream's full resource path, set whenever `ga4.streamWebsiteUrl` is declared. */
  streamName?: string;
  dataRetention?: { patch: { eventDataRetention: string }; updateMask: string[] };
  googleSignals?: { patch: { state: string }; updateMask: string[] };
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

  if (config.streamWebsiteUrl) {
    const stream = resolvedStream ?? (await resolveGa4Stream(ga4, config.streamWebsiteUrl));
    result.streamName = stream.name;

    if (config.enhancedMeasurement) {
      const current = (await ga4.getEnhancedMeasurementSettings(stream.name)) as Record<string, unknown>;
      const patch: Record<string, boolean> = {};
      const updateMask: string[] = [];
      for (const [key, value] of Object.entries(config.enhancedMeasurement)) {
        if (current[key] !== value) {
          patch[key] = value as boolean;
          updateMask.push(key);
        }
      }
      if (updateMask.length > 0) result.enhancedMeasurement = { patch, updateMask };
    }
  }

  return result;
}

export function hasGa4SettingsChanges(diff: Ga4SettingsDiff): boolean {
  return diff.dataRetention !== undefined || diff.googleSignals !== undefined || diff.enhancedMeasurement !== undefined;
}

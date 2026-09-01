import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Ga4Client } from './client.js';
import { diffGa4Settings, hasGa4SettingsChanges, verifyGa4SettingsApplied } from './settings.js';
import type { AnalyticsConfig } from '../../../config/schema.js';

function fakeAuth(routes: Record<string, unknown>): { request: (opts: { url: string }) => Promise<{ data: unknown }> } {
  return {
    request: async (opts) => {
      const key = Object.keys(routes).find((route) => opts.url.endsWith(route));
      if (!key) throw new Error(`unexpected request: ${opts.url}`);
      return { data: routes[key] };
    },
  };
}

function client(routes: Record<string, unknown>): Ga4Client {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Ga4Client(fakeAuth(routes) as any, '1');
}

function baseGa4Config(): AnalyticsConfig['ga4'] {
  return { dimensions: {}, metrics: {}, keyEvents: {}, audiences: {}, eventCreateRules: {}, eventEditRules: {}, calculatedMetrics: {}, channelGroups: {}, measurementProtocolSecrets: {}, };
}

test('diffGa4Settings is a no-op when config declares none of the settings', async () => {
  const diff = await diffGa4Settings(client({}), baseGa4Config());
  assert.deepEqual(diff, {});
  assert.equal(hasGa4SettingsChanges(diff), false);
});

test('diffGa4Settings surfaces a dataRetention change when it differs from live state', async () => {
  const ga4 = client({ dataRetentionSettings: { eventDataRetention: 'TWO_MONTHS', userDataRetention: 'TWO_MONTHS' } });
  const diff = await diffGa4Settings(ga4, { ...baseGa4Config(), dataRetention: 'FOURTEEN_MONTHS' });
  assert.deepEqual(diff.dataRetention, { patch: { eventDataRetention: 'FOURTEEN_MONTHS' }, updateMask: ['eventDataRetention'] });
});

test('diffGa4Settings is empty when dataRetention already matches live state', async () => {
  const ga4 = client({ dataRetentionSettings: { eventDataRetention: 'FOURTEEN_MONTHS', userDataRetention: 'TWO_MONTHS' } });
  const diff = await diffGa4Settings(ga4, { ...baseGa4Config(), dataRetention: 'FOURTEEN_MONTHS' });
  assert.equal(diff.dataRetention, undefined);
});

test('diffGa4Settings surfaces a googleSignals change when it differs from live state', async () => {
  const ga4 = client({ googleSignalsSettings: { state: 'GOOGLE_SIGNALS_ENABLED' } });
  const diff = await diffGa4Settings(ga4, { ...baseGa4Config(), googleSignals: 'GOOGLE_SIGNALS_DISABLED' });
  assert.deepEqual(diff.googleSignals, { patch: { state: 'GOOGLE_SIGNALS_DISABLED' }, updateMask: ['state'] });
});

test('diffGa4Settings surfaces only the attributionSettings fields that changed', async () => {
  const ga4 = client({
    attributionSettings: {
      reportingAttributionModel: 'PAID_AND_ORGANIC_CHANNELS_DATA_DRIVEN',
      acquisitionConversionEventLookbackWindow: 'ACQUISITION_CONVERSION_EVENT_LOOKBACK_WINDOW_30_DAYS',
      otherConversionEventLookbackWindow: 'OTHER_CONVERSION_EVENT_LOOKBACK_WINDOW_90_DAYS',
    },
  });
  const diff = await diffGa4Settings(ga4, {
    ...baseGa4Config(),
    attributionSettings: {
      reportingAttributionModel: 'PAID_AND_ORGANIC_CHANNELS_DATA_DRIVEN',
      otherConversionEventLookbackWindow: 'OTHER_CONVERSION_EVENT_LOOKBACK_WINDOW_60_DAYS',
    },
  });
  assert.deepEqual(diff.attributionSettings, {
    patch: { otherConversionEventLookbackWindow: 'OTHER_CONVERSION_EVENT_LOOKBACK_WINDOW_60_DAYS' },
    updateMask: ['otherConversionEventLookbackWindow'],
  });
});

test('diffGa4Settings is empty when attributionSettings already matches live state', async () => {
  const ga4 = client({
    attributionSettings: { reportingAttributionModel: 'PAID_AND_ORGANIC_CHANNELS_DATA_DRIVEN' },
  });
  const diff = await diffGa4Settings(ga4, {
    ...baseGa4Config(),
    attributionSettings: { reportingAttributionModel: 'PAID_AND_ORGANIC_CHANNELS_DATA_DRIVEN' },
  });
  assert.equal(diff.attributionSettings, undefined);
});

test('diffGa4Settings resolves the stream by URL and diffs only the enhanced measurement fields that changed', async () => {
  const ga4 = client({
    dataStreams: { dataStreams: [{ name: 'properties/1/dataStreams/9', type: 'WEB_DATA_STREAM', webStreamData: { defaultUri: 'https://example.com' } }] },
    enhancedMeasurementSettings: { scrollsEnabled: true, formInteractionsEnabled: true },
  });
  const diff = await diffGa4Settings(ga4, {
    ...baseGa4Config(),
    streamWebsiteUrl: 'https://example.com',
    enhancedMeasurement: { scrollsEnabled: false, formInteractionsEnabled: true },
  });
  assert.equal(diff.streamName, 'properties/1/dataStreams/9');
  assert.deepEqual(diff.enhancedMeasurement, { patch: { scrollsEnabled: false }, updateMask: ['scrollsEnabled'] });
});

test('diffGa4Settings does not flag a declared false enhancedMeasurement field the API omits (proto3 default)', async () => {
  const ga4 = client({
    dataStreams: { dataStreams: [{ name: 'properties/1/dataStreams/9', type: 'WEB_DATA_STREAM', webStreamData: { defaultUri: 'https://example.com' } }] },
    // proto3 JSON omits `false` fields entirely — outboundClicksEnabled is absent, not `false`.
    enhancedMeasurementSettings: { scrollsEnabled: true },
  });
  const diff = await diffGa4Settings(ga4, {
    ...baseGa4Config(),
    streamWebsiteUrl: 'https://example.com',
    enhancedMeasurement: { scrollsEnabled: true, outboundClicksEnabled: false },
  });
  assert.equal(diff.enhancedMeasurement, undefined);
});

test('diffGa4Settings still detects real drift when a declared-false field was enabled live', async () => {
  const ga4 = client({
    dataStreams: { dataStreams: [{ name: 'properties/1/dataStreams/9', type: 'WEB_DATA_STREAM', webStreamData: { defaultUri: 'https://example.com' } }] },
    enhancedMeasurementSettings: { outboundClicksEnabled: true },
  });
  const diff = await diffGa4Settings(ga4, {
    ...baseGa4Config(),
    streamWebsiteUrl: 'https://example.com',
    enhancedMeasurement: { outboundClicksEnabled: false },
  });
  assert.deepEqual(diff.enhancedMeasurement, { patch: { outboundClicksEnabled: false }, updateMask: ['outboundClicksEnabled'] });
});

test('diffGa4Settings throws when no stream matches the configured URL, listing the streams that do exist', async () => {
  const ga4 = client({ dataStreams: { dataStreams: [{ name: 'properties/1/dataStreams/9', type: 'WEB_DATA_STREAM', webStreamData: { defaultUri: 'https://other.example.com' } }] } });
  await assert.rejects(
    () => diffGa4Settings(ga4, { ...baseGa4Config(), streamWebsiteUrl: 'https://example.com' }),
    /No GA4 web data stream found.*https:\/\/other\.example\.com/,
  );
});

test('diffGa4Settings matches a stream URL regardless of a trailing slash', async () => {
  const ga4 = client({
    dataStreams: { dataStreams: [{ name: 'properties/1/dataStreams/9', type: 'WEB_DATA_STREAM', webStreamData: { defaultUri: 'https://example.com/' } }] },
  });
  const diff = await diffGa4Settings(ga4, { ...baseGa4Config(), streamWebsiteUrl: 'https://example.com' });
  assert.equal(diff.streamName, 'properties/1/dataStreams/9');
});

test('verifyGa4SettingsApplied reports a field the property did not take', async () => {
  const ga4 = client({
    'enhancedMeasurementSettings': { scrollsEnabled: true, siteSearchEnabled: false },
  });
  const mismatches = await verifyGa4SettingsApplied(ga4, {
    streamName: 'properties/1/dataStreams/2',
    enhancedMeasurement: { patch: { scrollsEnabled: true, siteSearchEnabled: true }, updateMask: ['scrollsEnabled', 'siteSearchEnabled'] },
  });
  assert.deepEqual(mismatches, [
    { setting: 'enhancedMeasurement', field: 'siteSearchEnabled', requested: true, live: false },
  ]);
});

test('verifyGa4SettingsApplied treats an absent boolean as false, not as a mismatch', async () => {
  const ga4 = client({ 'enhancedMeasurementSettings': { scrollsEnabled: true } });
  const mismatches = await verifyGa4SettingsApplied(ga4, {
    streamName: 'properties/1/dataStreams/2',
    enhancedMeasurement: { patch: { outboundClicksEnabled: false }, updateMask: ['outboundClicksEnabled'] },
  });
  assert.deepEqual(mismatches, []);
});

test('verifyGa4SettingsApplied is quiet when every patched field took', async () => {
  const ga4 = client({
    dataRetentionSettings: { eventDataRetention: 'FOURTEEN_MONTHS', userDataRetention: 'TWO_MONTHS' },
    googleSignalsSettings: { state: 'GOOGLE_SIGNALS_ENABLED' },
  });
  const mismatches = await verifyGa4SettingsApplied(ga4, {
    dataRetention: { patch: { eventDataRetention: 'FOURTEEN_MONTHS' }, updateMask: ['eventDataRetention'] },
    googleSignals: { patch: { state: 'GOOGLE_SIGNALS_ENABLED' }, updateMask: ['state'] },
  });
  assert.deepEqual(mismatches, []);
});

test('verifyGa4SettingsApplied makes no calls for settings the plan did not touch', async () => {
  assert.deepEqual(await verifyGa4SettingsApplied(client({}), {}), []);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Ga4Client } from './client.js';
import { diffGa4Settings, hasGa4SettingsChanges } from './settings.js';
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
  return { dimensions: {}, metrics: {}, keyEvents: {}, audiences: {}, eventCreateRules: {}, eventEditRules: {} };
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

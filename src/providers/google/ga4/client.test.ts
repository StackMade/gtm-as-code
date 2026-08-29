import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Ga4Client } from './client.js';
import { emptyState, recordManaged } from '../../../core/state.js';

function fakeAuth(response: unknown): { request: (opts: unknown) => Promise<{ data: unknown }> } {
  return { request: async () => ({ data: response }) };
}

test('listManaged filters remote dimensions to those recorded in state', async () => {
  const auth = fakeAuth({
    customDimensions: [
      { name: 'properties/1/customDimensions/1', parameterName: 'lead_type', scope: 'EVENT' },
      { name: 'properties/1/customDimensions/2', parameterName: 'unrelated', scope: 'EVENT' },
    ],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new Ga4Client(auth as any, '1');

  const key = client.stateKeyFor('dimension', 'lead_type');
  const state = recordManaged(emptyState(), key, 'properties/1/customDimensions/1');

  const managed = await client.listManaged('dimension', state);

  assert.deepEqual(
    managed.map((r) => r.id),
    ['lead_type'],
  );
});

test('list follows nextPageToken and asks for the largest page the API allows', async () => {
  const pages = [
    { customDimensions: [{ name: 'properties/1/customDimensions/1' }], nextPageToken: 'page-2' },
    { customDimensions: [{ name: 'properties/1/customDimensions/2' }] },
  ];
  const requests: Array<{ pageSize?: number; pageToken?: string }> = [];
  let call = 0;
  const auth = {
    request: async (options: { params?: { pageSize?: number; pageToken?: string } }) => {
      requests.push(options.params ?? {});
      return { data: pages[call++] };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new Ga4Client(auth as any, '1');

  const dimensions = await client.list('dimension');

  assert.deepEqual(
    dimensions.map((dimension) => dimension.name),
    ['properties/1/customDimensions/1', 'properties/1/customDimensions/2'],
  );
  assert.deepEqual(requests, [{ pageSize: 200 }, { pageSize: 200, pageToken: 'page-2' }]);
});

test('listManaged returns nothing when state has no entries for this property', async () => {
  const auth = fakeAuth({ customDimensions: [{ name: 'properties/1/customDimensions/1', parameterName: 'lead_type' }] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new Ga4Client(auth as any, '1');

  const managed = await client.listManaged('dimension', emptyState());

  assert.deepEqual(managed, []);
});

test('list on a stream-scoped kind requests the stream collection, not the property one', async () => {
  const requests: string[] = [];
  const auth = {
    request: async (options: { url: string }) => {
      requests.push(options.url);
      return { data: { eventCreateRules: [] } };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new Ga4Client(auth as any, '1');

  await client.list('eventCreateRule', 'properties/1/dataStreams/2');

  assert.deepEqual(requests, ['https://analyticsadmin.googleapis.com/v1alpha/properties/1/dataStreams/2/eventCreateRules']);
});

test('list on a stream-scoped kind throws when no stream name is given', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new Ga4Client(fakeAuth({}) as any, '1');

  await assert.rejects(() => client.list('eventCreateRule'), /stream-scoped/);
});

test('create on calculatedMetric sends calculatedMetricId as a query param, not a body field', async () => {
  const requests: Array<{ url: string; params?: Record<string, unknown>; data?: unknown }> = [];
  const auth = {
    request: async (options: { url: string; params?: Record<string, unknown>; data?: unknown }) => {
      requests.push(options);
      return { data: { name: 'properties/1/calculatedMetrics/revenue_per_session', ...(options.data as object) } };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new Ga4Client(auth as any, '1');

  await client.create('calculatedMetric', { displayName: 'Revenue per session', metricUnit: 'CURRENCY', formula: '(1)' }, undefined, 'revenue_per_session');

  assert.equal(requests[0].url, 'https://analyticsadmin.googleapis.com/v1alpha/properties/1/calculatedMetrics');
  assert.deepEqual(requests[0].params, { calculatedMetricId: 'revenue_per_session' });
  assert.deepEqual(requests[0].data, { displayName: 'Revenue per session', metricUnit: 'CURRENCY', formula: '(1)' });
});

test('create on calculatedMetric throws when no id override is given', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new Ga4Client(fakeAuth({}) as any, '1');

  await assert.rejects(() => client.create('calculatedMetric', { displayName: 'x', metricUnit: 'STANDARD', formula: '(1)' }), /calculatedMetricId/);
});

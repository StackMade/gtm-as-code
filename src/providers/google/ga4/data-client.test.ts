import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Ga4DataClient } from './data-client.js';

function fakeAuth(response: unknown): { request: (opts: unknown) => Promise<{ data: unknown }> } {
  return { request: async () => ({ data: response }) };
}

test('eventCounts maps eventName rows to their eventCount', async () => {
  const auth = fakeAuth({
    rows: [
      { dimensionValues: [{ value: 'lead_submit' }], metricValues: [{ value: '42' }] },
      { dimensionValues: [{ value: 'page_view' }], metricValues: [{ value: '1000' }] },
    ],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new Ga4DataClient(auth as any, '1');

  const counts = await client.eventCounts(28);

  assert.equal(counts.get('lead_submit'), 42);
  assert.equal(counts.get('page_view'), 1000);
  assert.equal(counts.get('never_fired'), undefined);
});

test('eventCounts throws rather than silently returning a truncated map', async () => {
  const auth = fakeAuth({
    rowCount: 3,
    rows: [{ dimensionValues: [{ value: 'lead_submit' }], metricValues: [{ value: '42' }] }],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new Ga4DataClient(auth as any, '1');

  await assert.rejects(() => client.eventCounts(28), /truncated/);
});

test('eventCounts returns an empty map when the property has no matching rows', async () => {
  const auth = fakeAuth({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new Ga4DataClient(auth as any, '1');

  const counts = await client.eventCounts(28);

  assert.equal(counts.size, 0);
});

test('hasParameterValue is true when a row carries a non-"(not set)" value', async () => {
  const auth = fakeAuth({ rows: [{ dimensionValues: [{ value: 'gold' }], metricValues: [{ value: '3' }] }] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new Ga4DataClient(auth as any, '1');

  assert.equal(await client.hasParameterValue('lead_submit', 'lead_type', 28), true);
});

test('hasParameterValue is false when every row is "(not set)"', async () => {
  const auth = fakeAuth({ rows: [{ dimensionValues: [{ value: '(not set)' }], metricValues: [{ value: '5' }] }] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new Ga4DataClient(auth as any, '1');

  assert.equal(await client.hasParameterValue('lead_submit', 'lead_type', 28), false);
});

test('hasParameterValue is false when there are no rows at all', async () => {
  const auth = fakeAuth({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new Ga4DataClient(auth as any, '1');

  assert.equal(await client.hasParameterValue('lead_submit', 'lead_type', 28), false);
});

test('quota returns the propertyQuota from the response', async () => {
  const auth = fakeAuth({ propertyQuota: { tokensPerDay: { consumed: 900, remaining: 100 } } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new Ga4DataClient(auth as any, '1');

  const quota = await client.quota();

  assert.deepEqual(quota, { tokensPerDay: { consumed: 900, remaining: 100 } });
});

test('runReport failures surface as Ga4ApiError with the request propertyId', async () => {
  const auth = { request: async () => { throw new Error('boom'); } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new Ga4DataClient(auth as any, '1');

  await assert.rejects(() => client.eventCounts(28), /Unable to run report for "1"/);
});

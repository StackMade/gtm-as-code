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

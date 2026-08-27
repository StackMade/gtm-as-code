import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GtmClient } from './client.js';
import { buildOwnershipNotes } from './ownership.js';

interface RequestOptions {
  params?: { pageToken?: string };
}

/** Serves one response per call, recording the page tokens it was asked for. */
function pagingAuth(pages: unknown[]): {
  request: (options: RequestOptions) => Promise<{ data: unknown }>;
  tokens: Array<string | undefined>;
} {
  const tokens: Array<string | undefined> = [];
  let call = 0;
  return {
    tokens,
    request: async (options: RequestOptions) => {
      tokens.push(options.params?.pageToken);
      return { data: pages[call++] };
    },
  };
}

const ref = { accountId: '1', containerId: '2', workspaceId: '3' };

test('list follows nextPageToken until the last page', async () => {
  const auth = pagingAuth([
    { tag: [{ tagId: '1' }], nextPageToken: 'page-2' },
    { tag: [{ tagId: '2' }] },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new GtmClient(auth as any, ref);

  const tags = await client.list('tag');

  assert.deepEqual(
    tags.map((tag) => tag.tagId),
    ['1', '2'],
  );
  assert.deepEqual(auth.tokens, [undefined, 'page-2']);
});

test('listManaged sees resources that only appear on a later page', async () => {
  const auth = pagingAuth([
    { trigger: [{ triggerId: '1', notes: 'unmanaged' }], nextPageToken: 'page-2' },
    { trigger: [{ triggerId: '2', notes: buildOwnershipNotes('purchase') }] },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new GtmClient(auth as any, ref);

  const managed = await client.listManaged('trigger');

  assert.deepEqual(
    managed.map((resource) => resource.id),
    ['purchase'],
  );
});

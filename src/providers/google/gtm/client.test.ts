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

test('createVersion posts to :create_version and returns the created version', async () => {
  const calls: unknown[] = [];
  const auth = {
    request: async (options: unknown) => {
      calls.push(options);
      return { data: { containerVersion: { containerVersionId: '9', name: 'v9' } } };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new GtmClient(auth as any, ref);

  const version = await client.createVersion('v9', 'notes');

  assert.deepEqual(version, { containerVersionId: '9', name: 'v9' });
  assert.deepEqual(calls, [
    { url: 'https://www.googleapis.com/tagmanager/v2/accounts/1/containers/2/workspaces/3:create_version', method: 'POST', data: { name: 'v9', notes: 'notes' } },
  ]);
});

test('createVersion throws when GTM reports a compiler error', async () => {
  const auth = { request: async () => ({ data: { compilerError: true } }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new GtmClient(auth as any, ref);

  await assert.rejects(() => client.createVersion('v9', 'notes'), /COMPILER_ERROR/);
});

test('publishVersion posts to versions/{id}:publish', async () => {
  const calls: unknown[] = [];
  const auth = {
    request: async (options: unknown) => {
      calls.push(options);
      return { data: {} };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new GtmClient(auth as any, ref);

  await client.publishVersion('9');

  assert.deepEqual(calls, [
    { url: 'https://www.googleapis.com/tagmanager/v2/accounts/1/containers/2/versions/9:publish', method: 'POST' },
  ]);
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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GtmClient, resolveWorkspaceId } from './client.js';
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

test('hasSyncConflicts reads syncStatus.mergeConflict off a :sync response', async () => {
  const auth = { request: async () => ({ data: { syncStatus: { mergeConflict: true } } }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new GtmClient(auth as any, ref);

  assert.equal(await client.hasSyncConflicts(), true);
});

test('hasSyncConflicts also reads a top-level mergeConflict array', async () => {
  const auth = { request: async () => ({ data: { mergeConflict: [{}] } }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new GtmClient(auth as any, ref);

  assert.equal(await client.hasSyncConflicts(), true);
});

test('hasSyncConflicts is false when the sync reports no conflicts', async () => {
  const auth = { request: async () => ({ data: {} }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new GtmClient(auth as any, ref);

  assert.equal(await client.hasSyncConflicts(), false);
});

test('listVersions returns the containerVersionHeader list', async () => {
  const auth = { request: async () => ({ data: { containerVersionHeader: [{ containerVersionId: '3' }, { containerVersionId: '2' }] } }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new GtmClient(auth as any, ref);

  assert.deepEqual(await client.listVersions(), [{ containerVersionId: '3' }, { containerVersionId: '2' }]);
});

test('liveVersion returns null on a NOT_FOUND response', async () => {
  const auth = { request: async () => Promise.reject({ response: { data: { error: { status: 'NOT_FOUND' } } } }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new GtmClient(auth as any, ref);

  assert.equal(await client.liveVersion(), null);
});

test('liveVersion returns the live version data', async () => {
  const auth = { request: async () => ({ data: { containerVersionId: '5', name: 'v5' } }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new GtmClient(auth as any, ref);

  assert.deepEqual(await client.liveVersion(), { containerVersionId: '5', name: 'v5' });
});

test('listEnabledBuiltInVariables returns the enabled types', async () => {
  const auth = { request: async () => ({ data: { builtInVariable: [{ type: 'pageUrl' }, { type: 'clickText' }] } }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new GtmClient(auth as any, ref);

  assert.deepEqual(await client.listEnabledBuiltInVariables(), ['pageUrl', 'clickText']);
});

test('enableBuiltInVariables posts one repeated `type` param per variable', async () => {
  const calls: unknown[] = [];
  const auth = {
    request: async (options: unknown) => {
      calls.push(options);
      return { data: {} };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new GtmClient(auth as any, ref);

  await client.enableBuiltInVariables(['pageUrl', 'clickText']);

  assert.deepEqual(calls, [
    {
      url: `https://www.googleapis.com/tagmanager/v2/accounts/${ref.accountId}/containers/${ref.containerId}/workspaces/${ref.workspaceId}/built_in_variables`,
      method: 'POST',
      params: [
        ['type', 'pageUrl'],
        ['type', 'clickText'],
      ],
    },
  ]);
});

test('enableBuiltInVariables is a no-op for an empty list', async () => {
  const auth = { request: async () => assert.fail('should not call the API') };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new GtmClient(auth as any, ref);

  await client.enableBuiltInVariables([]);
});

test('update preserves the remote object\'s hand-written notes alongside the ownership stamp', async () => {
  const calls: unknown[] = [];
  const auth = {
    request: async (options: unknown) => {
      calls.push(options);
      return { data: {} };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new GtmClient(auth as any, ref);
  const existingNotes = buildOwnershipNotes('purchase', false, 'Handles the contact form.');

  await client.update('trigger', 'purchase', '7', { name: 'purchase', type: 'pageview' }, false, existingNotes);

  const body = (calls[0] as { data: { notes: string } }).data;
  assert.match(body.notes, /Handles the contact form\./);
  assert.match(body.notes, /resource-id: purchase/);
});

test('update falls back to just the ownership stamp when there were no existing notes', async () => {
  const calls: unknown[] = [];
  const auth = {
    request: async (options: unknown) => {
      calls.push(options);
      return { data: {} };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new GtmClient(auth as any, ref);

  await client.update('trigger', 'purchase', '7', { name: 'purchase', type: 'pageview' }, false, undefined);

  const body = (calls[0] as { data: { notes: string } }).data;
  assert.match(body.notes, /resource-id: purchase/);
  assert.doesNotMatch(body.notes, /Handles/);
});

test('resolveWorkspaceId returns the first workspace when none is configured', async () => {
  const auth = { request: async () => ({ data: { workspace: [{ workspaceId: '4', name: 'Default Workspace' }, { workspaceId: '5' }] } }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const id = await resolveWorkspaceId(auth as any, '1', '2', undefined);

  assert.equal(id, '4');
});

test('resolveWorkspaceId matches a configured workspace id directly', async () => {
  const auth = { request: async () => ({ data: { workspace: [{ workspaceId: '4', name: 'Default Workspace' }, { workspaceId: '5', name: 'Staging' }] } }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const id = await resolveWorkspaceId(auth as any, '1', '2', '5');

  assert.equal(id, '5');
});

test('resolveWorkspaceId matches a configured workspace by display name', async () => {
  const auth = { request: async () => ({ data: { workspace: [{ workspaceId: '4', name: 'Default Workspace' }, { workspaceId: '5', name: 'Staging' }] } }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const id = await resolveWorkspaceId(auth as any, '1', '2', 'Staging');

  assert.equal(id, '5');
});

test('resolveWorkspaceId throws a clear error naming the workspace field when nothing matches', async () => {
  const auth = { request: async () => ({ data: { workspace: [{ workspaceId: '4', name: 'Default Workspace' }] } }) };

  await assert.rejects(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => resolveWorkspaceId(auth as any, '1', '2', 'Nonexistent'),
    /google\.gtm\.workspace is set to "Nonexistent"/,
  );
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

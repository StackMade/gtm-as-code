import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apply, findProtectedDeletes } from './apply.js';
import type { Change } from '../../core/resource.js';
import { GoogleAuth } from 'google-auth-library';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computePlan } from './plan.js';
import { validate } from './validate.js';

const deleteProtected: Change = {
  operation: 'delete',
  resource: { id: 'checkout_pixel', type: 'gtm.tag', provider: 'google', desiredState: { protected: true } },
};
const deleteUnprotected: Change = {
  operation: 'delete',
  resource: { id: 'debug_tag', type: 'gtm.tag', provider: 'google', desiredState: { protected: false } },
};
const deleteNoFlag: Change = {
  operation: 'delete',
  resource: { id: 'old_tag', type: 'gtm.tag', provider: 'google', desiredState: {} },
};
const createChange: Change = {
  operation: 'create',
  resource: { id: 'new_tag', type: 'gtm.tag', provider: 'google', desiredState: { protected: true } },
};

test('findProtectedDeletes returns only deletes of resources marked protected', () => {
  const result = findProtectedDeletes([deleteProtected, deleteUnprotected, deleteNoFlag, createChange]);
  assert.deepEqual(result, [deleteProtected]);
});

test('findProtectedDeletes returns an empty array when nothing is protected', () => {
  assert.deepEqual(findProtectedDeletes([deleteUnprotected, deleteNoFlag]), []);
});

test('validate, plan and apply reject dependency cycles before auth or writes', async (t) => {
  const auth = t.mock.method(GoogleAuth.prototype, 'getClient', async () => { throw new Error('Unexpected credential access'); });
  const errors: string[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { errors.push(args.join(' ')); });
  const dir = mkdtempSync(join(tmpdir(), 'gtm-cycle-preflight-'));
  const config = join(dir, 'analytics.yaml');
  const previousExitCode = process.exitCode;
  try {
    for (const variables of [
      { a: { type: 'constant', value: '{{b}}' }, b: { type: 'constant', value: '{{a}}' } },
      { a: { type: 'constant', value: '{{a}}' } },
    ]) {
      writeFileSync(config, JSON.stringify({
        version: 1, project: { name: 'test' },
        google: { gtm: { accountId: '1', containerId: '1' }, ga4: { propertyId: '1' } },
        gtm: { variables }, ga4: { dataRetention: 'FOURTEEN_MONTHS' },
      }));
      const opts = { config, autoApprove: true, verbose: false, quiet: false, format: 'text' as const };
      process.exitCode = 0;
      validate(opts);
      assert.equal(process.exitCode, 1);
      assert.match(errors.at(-1) ?? '', /Circular dependency/);
      await assert.rejects(() => computePlan(opts, []), /Circular dependency/);
      process.exitCode = 0;
      await apply(opts);
      assert.equal(process.exitCode, 1);
      assert.match(errors.at(-1) ?? '', /Circular dependency/);
    }
    assert.equal(auth.mock.callCount(), 0);
  } finally {
    process.exitCode = previousExitCode;
  }
});

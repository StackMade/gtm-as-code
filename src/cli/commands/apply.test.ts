import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findProtectedDeletes } from './apply.js';
import type { Change } from '../../core/resource.js';

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

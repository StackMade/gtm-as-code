import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GtmApiError, extractApiStatus } from './errors.js';

test('formats an API failure with a remediation hint', () => {
  const error = new GtmApiError('create variable', 'form', 'RESOURCE_EXHAUSTED');
  assert.match(error.message, /^Unable to create variable "form"\.\n\nGoogle API:\nRESOURCE_EXHAUSTED/);
  assert.match(error.message, /resource limit/);
});

test('unrecognized status has no fabricated remediation line', () => {
  const error = new GtmApiError('list triggers', 'c1', 'INTERNAL');
  assert.equal(error.message, 'Unable to list triggers "c1".\n\nGoogle API:\nINTERNAL');
});

test('extractApiStatus reads the Google API error body off a gaxios-style error', () => {
  const gaxiosLikeError = { response: { data: { error: { status: 'PERMISSION_DENIED' } } } };
  assert.equal(extractApiStatus(gaxiosLikeError), 'PERMISSION_DENIED');
});

test('extractApiStatus falls back to the raw error message', () => {
  assert.equal(extractApiStatus(new Error('network down')), 'network down');
});

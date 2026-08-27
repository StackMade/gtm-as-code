import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Ga4ApiError } from './errors.js';

test('formats an API failure with a remediation hint', () => {
  const error = new Ga4ApiError('create dimension', 'lead_type', 'RESOURCE_EXHAUSTED');
  assert.equal(
    error.message,
    'Unable to create dimension "lead_type".\n\nGoogle API:\nRESOURCE_EXHAUSTED\n\nYour GA4 property may have reached its custom dimension/metric/key event limit.',
  );
});

test('unrecognized status has no fabricated remediation line', () => {
  const error = new Ga4ApiError('list keyEvents', 'p1', 'INTERNAL');
  assert.equal(error.message, 'Unable to list keyEvents "p1".\n\nGoogle API:\nINTERNAL');
});

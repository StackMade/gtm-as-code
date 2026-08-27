import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toGa4Payload, fromGa4Payload } from './mapping.js';

test('dimension maps scope to uppercase and back to lowercase', () => {
  const ga4 = toGa4Payload('dimension', 'lead_type', { scope: 'event', parameter: 'lead_type' });
  assert.deepEqual(ga4, { parameterName: 'lead_type', displayName: 'lead_type', scope: 'EVENT' });
  assert.deepEqual(fromGa4Payload('dimension', ga4), { scope: 'event', parameter: 'lead_type' });
});

test('metric defaults measurementUnit to standard when absent', () => {
  const ga4 = toGa4Payload('metric', 'basket_value', { scope: 'event', parameter: 'basket_value' });
  assert.equal(ga4.measurementUnit, 'STANDARD');
});

test('keyEvent maps the resource id to eventName', () => {
  const ga4 = toGa4Payload('keyEvent', 'generate_lead', {});
  assert.deepEqual(ga4, { eventName: 'generate_lead', countingMethod: 'ONCE_PER_EVENT' });
});

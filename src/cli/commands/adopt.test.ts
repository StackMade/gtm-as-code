import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findGtmMatch } from './adopt.js';
import type { GtmObject } from '../../providers/google/gtm/client.js';

const triggers: GtmObject[] = [
  { triggerId: '5', name: 'Generate Lead', type: 'customEvent' },
  { triggerId: '6', name: 'Submit Form', type: 'customEvent' },
];

test('findGtmMatch finds the object whose slugified name equals the given id', () => {
  const match = findGtmMatch(triggers, 'trigger', 'submit_form');
  assert.deepEqual(match, { object: triggers[1], gtmId: '6' });
});

test('findGtmMatch returns null when no object slugifies to that id', () => {
  assert.equal(findGtmMatch(triggers, 'trigger', 'nonexistent'), null);
});

test('findGtmMatch returns null when the matched object has no id field for this kind', () => {
  const objects: GtmObject[] = [{ name: 'Odd One' }];
  assert.equal(findGtmMatch(objects, 'trigger', 'odd_one'), null);
});

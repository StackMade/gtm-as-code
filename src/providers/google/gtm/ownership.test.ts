import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOwnershipNotes, parseOwnershipNotes, MANAGED_BY } from './ownership.js';

test('parses ownership stamped by buildOwnershipNotes', () => {
  const notes = buildOwnershipNotes('generate_lead');
  assert.match(notes, new RegExp(MANAGED_BY.replace('/', '\\/')));
  assert.deepEqual(parseOwnershipNotes(notes), { resourceId: 'generate_lead', protected: false });
});

test('preserves pre-existing user notes alongside ownership metadata', () => {
  const notes = buildOwnershipNotes('generate_lead', false, 'Handles the contact form.');
  assert.match(notes, /Handles the contact form\./);
  assert.deepEqual(parseOwnershipNotes(notes), { resourceId: 'generate_lead', protected: false });
});

test('unmanaged resources (no ownership marker) parse to null', () => {
  assert.equal(parseOwnershipNotes(undefined), null);
  assert.equal(parseOwnershipNotes('Just a manual note.'), null);
  assert.equal(parseOwnershipNotes('managed-by: someone/else\nresource-id: x'), null);
});

test('protected resources are stamped and parsed back as protected', () => {
  const notes = buildOwnershipNotes('generate_lead', true);
  assert.deepEqual(parseOwnershipNotes(notes), { resourceId: 'generate_lead', protected: true });
});

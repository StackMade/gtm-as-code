import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOwnershipNotes, extractUserNotes, parseOwnershipNotes, MANAGED_BY } from './ownership.js';

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

test('extractUserNotes strips the ownership block off a managed resource', () => {
  const notes = buildOwnershipNotes('generate_lead', false, 'Handles the contact form.');
  assert.equal(extractUserNotes(notes), 'Handles the contact form.');
});

test('extractUserNotes returns undefined when there is no user text', () => {
  const notes = buildOwnershipNotes('generate_lead');
  assert.equal(extractUserNotes(notes), undefined);
});

test('extractUserNotes passes through notes with no ownership marker unchanged', () => {
  assert.equal(extractUserNotes('Just a manual note.'), 'Just a manual note.');
  assert.equal(extractUserNotes(undefined), undefined);
});

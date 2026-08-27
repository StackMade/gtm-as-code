import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diff } from './diff.js';
import type { Resource } from './resource.js';

function resource(id: string, desiredState: unknown): Resource {
  return { id, type: 'gtm.tag', provider: 'google', desiredState };
}

test('rename (same logical id) produces an update, not create+delete', () => {
  const remote = [resource('generate_lead', { name: 'GA4 - lead' })];
  const desired = [resource('generate_lead', { name: 'GA4 - generate_lead' })];

  const changes = diff(desired, remote);

  assert.equal(changes.length, 1);
  assert.equal(changes[0].operation, 'update');
});

test('unmanaged remote resources never appear in the diff', () => {
  // The provider is expected to have already filtered `remote` down to
  // managed resources before it reaches the diff engine.
  const remote = [resource('generate_lead', { name: 'GA4 - generate_lead' })];
  const desired = [resource('generate_lead', { name: 'GA4 - generate_lead' })];

  const changes = diff(desired, remote);

  assert.deepEqual(changes, []);
});

test('resource only in desired state is a create', () => {
  const changes = diff([resource('new_tag', { name: 'x' })], []);
  assert.deepEqual(changes, [{ operation: 'create', resource: resource('new_tag', { name: 'x' }) }]);
});

test('managed resource missing from desired state is a delete', () => {
  const remote = resource('old_tag', { name: 'x' });
  const changes = diff([], [remote]);
  assert.deepEqual(changes, [{ operation: 'delete', resource: remote }]);
});

test('same id across different types (event-derived trigger + tag) diffs independently, no collision', () => {
  const trigger: Resource = { id: 'generate_lead', type: 'gtm.trigger', provider: 'google', desiredState: { type: 'customEvent' } };
  const tag: Resource = { id: 'generate_lead', type: 'gtm.tag', provider: 'google', desiredState: { type: 'ga4Event' } };

  const changes = diff([trigger, tag], [trigger]);

  assert.deepEqual(changes, [{ operation: 'create', resource: tag }]);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyEvent, hasProblems, renderMarkdown, type VerifyReport } from './verify.js';
import type { EventDef } from '../../config/schema.js';

function event(parameters: EventDef['parameters']): EventDef {
  return { parameters };
}

test('classifyEvent marks an event with zero eventCount as not received, skipping parameter checks', () => {
  const result = classifyEvent('lead_submit', event({ lead_type: { type: 'string', dimension: true } }), 0, {});
  assert.equal(result.received, false);
  assert.deepEqual(result.missingParameters, []);
});

test('classifyEvent buckets a dimension parameter as missing when its status says so', () => {
  const result = classifyEvent('lead_submit', event({ lead_type: { type: 'string', dimension: true } }), 5, { lead_type: 'missing' });
  assert.deepEqual(result.missingParameters, ['lead_type']);
});

test('classifyEvent buckets a not-yet-registered dimension separately from missing', () => {
  const result = classifyEvent('lead_submit', event({ lead_type: { type: 'string', dimension: true } }), 5, { lead_type: 'not-registered' });
  assert.deepEqual(result.notRegisteredParameters, ['lead_type']);
  assert.deepEqual(result.missingParameters, []);
});

test('classifyEvent treats a non-dimension parameter as unverifiable, never checked', () => {
  const result = classifyEvent('lead_submit', event({ raw_value: { type: 'string' } }), 5, {});
  assert.deepEqual(result.unverifiableParameters, ['raw_value']);
  assert.deepEqual(result.missingParameters, []);
});

test('classifyEvent skips optional parameters entirely', () => {
  const result = classifyEvent('lead_submit', event({ lead_type: { type: 'string', dimension: true, optional: true } }), 5, { lead_type: 'missing' });
  assert.deepEqual(result.missingParameters, []);
  assert.deepEqual(result.unverifiableParameters, []);
});

test('hasProblems is true when any event was never received', () => {
  const report: VerifyReport = { days: 28, events: [{ eventId: 'a', received: false, eventCount: 0, missingParameters: [], notRegisteredParameters: [], unverifiableParameters: [] }] };
  assert.equal(hasProblems(report), true);
});

test('hasProblems is true when any event has a missing parameter', () => {
  const report: VerifyReport = { days: 28, events: [{ eventId: 'a', received: true, eventCount: 3, missingParameters: ['lead_type'], notRegisteredParameters: [], unverifiableParameters: [] }] };
  assert.equal(hasProblems(report), true);
});

test('hasProblems is false when every event was received with no missing parameters', () => {
  const report: VerifyReport = { days: 28, events: [{ eventId: 'a', received: true, eventCount: 3, missingParameters: [], notRegisteredParameters: [], unverifiableParameters: [] }] };
  assert.equal(hasProblems(report), false);
});

test('renderMarkdown reports a clean summary when nothing is wrong', () => {
  const report: VerifyReport = { days: 28, events: [{ eventId: 'a', received: true, eventCount: 3, missingParameters: [], notRegisteredParameters: [], unverifiableParameters: [] }] };
  assert.match(renderMarkdown(report), /all declared events received/);
});

test('renderMarkdown lists a never-received event', () => {
  const report: VerifyReport = { days: 28, events: [{ eventId: 'lead_submit', received: false, eventCount: 0, missingParameters: [], notRegisteredParameters: [], unverifiableParameters: [] }] };
  assert.match(renderMarkdown(report), /`lead_submit`: never received/);
});

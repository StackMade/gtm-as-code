import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toGtmPayload, fromGtmPayload } from './mapping.js';

test('dataLayerVariable maps to GTM "v" type and back', () => {
  const gtm = toGtmPayload('variable', 'form', { type: 'dataLayerVariable', variableName: 'form' });
  assert.deepEqual(gtm, { name: 'form', type: 'v', parameter: [{ type: 'template', key: 'name', value: 'form' }] });
  assert.deepEqual(fromGtmPayload('variable', gtm), { type: 'dataLayerVariable', variableName: 'form' });
});

test('customEvent trigger maps to GTM customEventFilter and back', () => {
  const gtm = toGtmPayload('trigger', 'generate_lead', { type: 'customEvent', eventName: 'generate_lead' });
  assert.equal(gtm.type, 'customEvent');
  assert.deepEqual(fromGtmPayload('trigger', gtm), { type: 'customEvent', eventName: 'generate_lead' });
});

test('ga4Event tag maps parameters into eventSettingsTable and back', () => {
  const gtm = toGtmPayload(
    'tag',
    'generate_lead',
    {
      type: 'ga4Event',
      eventName: 'generate_lead',
      trigger: ['generate_lead'],
      parameters: { form: '{{form}}', source: '{{source}}' },
    },
    { measurementId: 'G-TESTTEST', triggerGtmIds: { generate_lead: '5' } },
  );
  assert.equal(gtm.type, 'gaawe');
  assert.deepEqual(gtm.firingTriggerId, ['5']);
  assert.deepEqual(fromGtmPayload('tag', gtm, { triggerGtmIdToLogicalId: { '5': 'generate_lead' } }), {
    type: 'ga4Event',
    eventName: 'generate_lead',
    measurementId: 'G-TESTTEST',
    parameters: { form: '{{form}}', source: '{{source}}' },
    trigger: ['generate_lead'],
    exceptTrigger: [],
  });
});

test('ga4Event reverse mapping without a reverse trigger-id context yields an empty trigger list', () => {
  const gtm = toGtmPayload(
    'tag',
    'generate_lead',
    { type: 'ga4Event', eventName: 'generate_lead', trigger: ['generate_lead'], parameters: {} },
    { measurementId: 'G-TESTTEST', triggerGtmIds: { generate_lead: '5' } },
  );
  assert.deepEqual(fromGtmPayload('tag', gtm).trigger, []);
});

test('googleTag (GA4 configuration) maps to GTM "googtag" type and back', () => {
  const gtm = toGtmPayload('tag', 'ga4_config', { type: 'googleTag', measurementId: 'G-TESTTEST' });
  assert.deepEqual(gtm, { name: 'ga4_config', type: 'googtag', parameter: [{ type: 'template', key: 'tagId', value: 'G-TESTTEST' }] });
  assert.deepEqual(fromGtmPayload('tag', gtm), {
    type: 'googleTag',
    measurementId: 'G-TESTTEST',
    configParameters: {},
    trigger: [],
    exceptTrigger: [],
  });
});

test('googleTag maps configParameters into configSettingsTable and back', () => {
  const gtm = toGtmPayload('tag', 'ga4_config', {
    type: 'googleTag',
    measurementId: 'G-TESTTEST',
    configParameters: { send_page_view: 'false' },
  });
  const parameter = gtm.parameter as Array<{ key: string }>;
  const table = parameter.find((p) => p.key === 'configSettingsTable');
  assert.deepEqual(table, {
    type: 'list',
    key: 'configSettingsTable',
    list: [{ type: 'map', map: [{ type: 'template', key: 'parameter', value: 'send_page_view' }, { type: 'template', key: 'parameterValue', value: 'false' }] }],
  });
  assert.deepEqual(fromGtmPayload('tag', gtm), {
    type: 'googleTag',
    measurementId: 'G-TESTTEST',
    configParameters: { send_page_view: 'false' },
    trigger: [],
    exceptTrigger: [],
  });
});

test('googleTag maps trigger into firingTriggerId and back', () => {
  const gtm = toGtmPayload(
    'tag',
    'ga4_config',
    { type: 'googleTag', measurementId: 'G-TESTTEST', trigger: ['all_pages'] },
    { triggerGtmIds: { all_pages: '3' } },
  );
  assert.deepEqual(gtm.firingTriggerId, ['3']);
  assert.deepEqual(fromGtmPayload('tag', gtm, { triggerGtmIdToLogicalId: { '3': 'all_pages' } }), {
    type: 'googleTag',
    measurementId: 'G-TESTTEST',
    configParameters: {},
    trigger: ['all_pages'],
    exceptTrigger: [],
  });
});

test('googleTag maps exceptTrigger into blockingTriggerId and back', () => {
  const gtm = toGtmPayload(
    'tag',
    'ga4_config',
    { type: 'googleTag', measurementId: 'G-TESTTEST', exceptTrigger: ['debug_mode'] },
    { triggerGtmIds: { debug_mode: '9' } },
  );
  assert.deepEqual(gtm.blockingTriggerId, ['9']);
  assert.equal(gtm.firingTriggerId, undefined);
  assert.deepEqual(fromGtmPayload('tag', gtm, { triggerGtmIdToLogicalId: { '9': 'debug_mode' } }), {
    type: 'googleTag',
    measurementId: 'G-TESTTEST',
    configParameters: {},
    trigger: [],
    exceptTrigger: ['debug_mode'],
  });
});

test('googleTag reverse mapping without a reverse trigger-id context yields an empty trigger list', () => {
  const gtm = toGtmPayload(
    'tag',
    'ga4_config',
    { type: 'googleTag', measurementId: 'G-TESTTEST', trigger: ['all_pages'] },
    { triggerGtmIds: { all_pages: '3' } },
  );
  assert.deepEqual(fromGtmPayload('tag', gtm).trigger, []);
});

test('unknown type throws rather than silently producing a bad payload', () => {
  assert.throws(() => toGtmPayload('tag', 'x', { type: 'somethingElse' }), /No GTM payload mapping/);
});

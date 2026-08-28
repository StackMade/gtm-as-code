import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toGtmPayload, fromGtmPayload } from './mapping.js';

test('dataLayerVariable maps to GTM "v" type and back', () => {
  const gtm = toGtmPayload('variable', 'form', { type: 'dataLayerVariable', variableName: 'form' });
  assert.deepEqual(gtm, { name: 'form', type: 'v', parameter: [{ type: 'template', key: 'name', value: 'form' }] });
  assert.deepEqual(fromGtmPayload('variable', gtm), { type: 'dataLayerVariable', variableName: 'form' });
});

test('folder maps to a bare GTM object and back', () => {
  const gtm = toGtmPayload('folder', 'consent', {});
  assert.deepEqual(gtm, { name: 'consent' });
  assert.deepEqual(fromGtmPayload('folder', gtm), { name: 'consent' });
});

test('a resource with a folder gets parentFolderId resolved from context, and recovered back', () => {
  const gtm = toGtmPayload(
    'variable',
    'form',
    { type: 'dataLayerVariable', variableName: 'form', folder: 'consent' },
    { folderGtmIds: { consent: '99' } },
  );
  assert.equal(gtm.parentFolderId, '99');
  assert.deepEqual(fromGtmPayload('variable', gtm, { folderGtmIdToLogicalId: { '99': 'consent' } }), {
    type: 'dataLayerVariable',
    variableName: 'form',
    folder: 'consent',
  });
});

test('customEvent trigger maps to GTM customEventFilter and back', () => {
  const gtm = toGtmPayload('trigger', 'generate_lead', { type: 'customEvent', eventName: 'generate_lead' });
  assert.equal(gtm.type, 'customEvent');
  assert.deepEqual(fromGtmPayload('trigger', gtm), { type: 'customEvent', eventName: 'generate_lead' });
});

test('customEvent trigger with eventNameMatchType "regex" maps to GTM matchRegex filter and back', () => {
  const gtm = toGtmPayload('trigger', 'purchase_any', {
    type: 'customEvent',
    eventName: '^purchase_.*',
    eventNameMatchType: 'regex',
  });
  const filter = (gtm.customEventFilter as Array<{ type: string }>)[0];
  assert.equal(filter.type, 'matchRegex');
  assert.deepEqual(fromGtmPayload('trigger', gtm), {
    type: 'customEvent',
    eventName: '^purchase_.*',
    eventNameMatchType: 'regex',
  });
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

test('googleTag resolves a reserved built-in trigger name to its fixed GTM id, with no config trigger declared', () => {
  const gtm = toGtmPayload('tag', 'ga4_config', {
    type: 'googleTag',
    measurementId: 'G-TESTTEST',
    trigger: ['Initialization - All Pages'],
  });
  assert.deepEqual(gtm.firingTriggerId, ['2147479573']);
});

test('a config-declared trigger id wins over a same-named built-in trigger', () => {
  const gtm = toGtmPayload(
    'tag',
    'ga4_config',
    { type: 'googleTag', measurementId: 'G-TESTTEST', trigger: ['All Pages'] },
    { triggerGtmIds: { 'All Pages': '42' } },
  );
  assert.deepEqual(gtm.firingTriggerId, ['42']);
});

test('reverse mapping recovers a built-in trigger id back to its reserved name', () => {
  const gtm = toGtmPayload('tag', 'ga4_config', {
    type: 'googleTag',
    measurementId: 'G-TESTTEST',
    trigger: ['Initialization - All Pages'],
  });
  assert.deepEqual(fromGtmPayload('tag', gtm).trigger, ['Initialization - All Pages']);
});

test('constant variable maps to GTM "c" type and back', () => {
  const gtm = toGtmPayload('variable', 'env', { type: 'constant', value: 'prod' });
  assert.deepEqual(gtm, { name: 'env', type: 'c', parameter: [{ type: 'template', key: 'value', value: 'prod' }] });
  assert.deepEqual(fromGtmPayload('variable', gtm), { type: 'constant', value: 'prod' });
});

test('customJavaScript variable maps to GTM "jsm" type and back', () => {
  const gtm = toGtmPayload('variable', 'is_mobile', { type: 'customJavaScript', javascript: 'function(){return true;}' });
  assert.deepEqual(gtm, {
    name: 'is_mobile',
    type: 'jsm',
    parameter: [{ type: 'template', key: 'javascript', value: 'function(){return true;}' }],
  });
  assert.deepEqual(fromGtmPayload('variable', gtm), { type: 'customJavaScript', javascript: 'function(){return true;}' });
});

test('lookupTable variable maps its map into GTM list/map parameters and back', () => {
  const gtm = toGtmPayload('variable', 'plan_name', {
    type: 'lookupTable',
    input: '{{plan_id}}',
    map: [{ key: 'p1', value: 'Starter' }],
  });
  assert.equal(gtm.type, 'smm');
  assert.deepEqual(fromGtmPayload('variable', gtm), {
    type: 'lookupTable',
    input: '{{plan_id}}',
    map: [{ key: 'p1', value: 'Starter' }],
  });
});

test('regexTable variable maps its map into GTM list/map parameters (pattern key) and back', () => {
  const gtm = toGtmPayload('variable', 'device_type', {
    type: 'regexTable',
    input: '{{User Agent}}',
    map: [{ pattern: '^iPhone', value: 'mobile' }],
    defaultValue: 'desktop',
  });
  assert.equal(gtm.type, 'remm');
  assert.deepEqual(fromGtmPayload('variable', gtm), {
    type: 'regexTable',
    input: '{{User Agent}}',
    map: [{ pattern: '^iPhone', value: 'mobile' }],
    defaultValue: 'desktop',
  });
});

test('url variable maps to GTM "u" type and back', () => {
  const gtm = toGtmPayload('variable', 'host', { type: 'url', component: 'HOST' });
  assert.deepEqual(gtm, { name: 'host', type: 'u', parameter: [{ type: 'template', key: 'component', value: 'HOST' }] });
  assert.deepEqual(fromGtmPayload('variable', gtm), { type: 'url', component: 'HOST' });
});

test('cookie variable maps to GTM "k" type and back', () => {
  const gtm = toGtmPayload('variable', 'session_id', { type: 'cookie', name: '_sid' });
  assert.deepEqual(gtm, { name: 'session_id', type: 'k', parameter: [{ type: 'template', key: 'name', value: '_sid' }] });
  assert.deepEqual(fromGtmPayload('variable', gtm), { type: 'cookie', name: '_sid' });
});

test('domElement variable maps to GTM "d" type and back', () => {
  const gtm = toGtmPayload('variable', 'price', { type: 'domElement', elementId: 'price-tag' });
  assert.deepEqual(gtm, { name: 'price', type: 'd', parameter: [{ type: 'template', key: 'elementId', value: 'price-tag' }] });
  assert.deepEqual(fromGtmPayload('variable', gtm), { type: 'domElement', elementId: 'price-tag' });
});

test('javascriptVariable maps to GTM "j" type and back', () => {
  const gtm = toGtmPayload('variable', 'window_foo', { type: 'javascriptVariable', name: 'window.foo' });
  assert.deepEqual(gtm, { name: 'window_foo', type: 'j', parameter: [{ type: 'template', key: 'name', value: 'window.foo' }] });
  assert.deepEqual(fromGtmPayload('variable', gtm), { type: 'javascriptVariable', name: 'window.foo' });
});

test('autoEventVariable maps to GTM "aev" type and back', () => {
  const gtm = toGtmPayload('variable', 'click_text', { type: 'autoEventVariable', varType: 'TAG_NAME' });
  assert.deepEqual(gtm, { name: 'click_text', type: 'aev', parameter: [{ type: 'template', key: 'varType', value: 'TAG_NAME' }] });
  assert.deepEqual(fromGtmPayload('variable', gtm), { type: 'autoEventVariable', varType: 'TAG_NAME' });
});

test('googleTagSettings variable maps to a bare GTM "gtes" type and back', () => {
  const gtm = toGtmPayload('variable', 'gtag_settings', { type: 'googleTagSettings' });
  assert.deepEqual(gtm, { name: 'gtag_settings', type: 'gtes' });
  assert.deepEqual(fromGtmPayload('variable', gtm), { type: 'googleTagSettings' });
});

for (const type of ['pageview', 'domReady', 'windowLoaded', 'click', 'linkClick', 'formSubmission', 'scrollDepth', 'historyChange', 'jsError']) {
  test(`${type} trigger maps to a bare GTM object and back`, () => {
    const gtm = toGtmPayload('trigger', `t_${type}`, { type });
    assert.deepEqual(gtm, { name: `t_${type}`, type });
    assert.deepEqual(fromGtmPayload('trigger', gtm), { type });
  });
}

test('elementVisibility trigger maps selector fields and back', () => {
  const gtm = toGtmPayload('trigger', 'visible_cta', { type: 'elementVisibility', selectorType: 'CSS', elementSelector: '.cta' });
  assert.equal(gtm.type, 'elementVisibility');
  assert.deepEqual(fromGtmPayload('trigger', gtm), { type: 'elementVisibility', selectorType: 'CSS', elementSelector: '.cta' });
});

test('timer trigger maps interval/limit to top-level fields and back', () => {
  const gtm = toGtmPayload('trigger', 'heartbeat', { type: 'timer', interval: '1000', limit: '5' });
  assert.deepEqual(gtm.interval, { type: 'template', value: '1000' });
  assert.deepEqual(gtm.limit, { type: 'template', value: '5' });
  assert.deepEqual(fromGtmPayload('trigger', gtm), { type: 'timer', interval: '1000', limit: '5' });
});

test('triggerGroup resolves member trigger ids from context and back', () => {
  const gtm = toGtmPayload(
    'trigger',
    'engaged',
    { type: 'triggerGroup', triggers: ['scroll_50', 'time_30s'] },
    { triggerGtmIds: { scroll_50: '10', time_30s: '11' } },
  );
  assert.equal(gtm.type, 'triggerGroup');
  assert.deepEqual(fromGtmPayload('trigger', gtm, { triggerGtmIdToLogicalId: { '10': 'scroll_50', '11': 'time_30s' } }), {
    type: 'triggerGroup',
    triggers: ['scroll_50', 'time_30s'],
  });
});

test('customHtml tag maps to GTM "html" type and back', () => {
  const gtm = toGtmPayload('tag', 'consent_snippet', { type: 'customHtml', html: '<script>1</script>' });
  assert.deepEqual(gtm, {
    name: 'consent_snippet',
    type: 'html',
    parameter: [
      { type: 'template', key: 'html', value: '<script>1</script>' },
      { type: 'boolean', key: 'supportDocumentWrite', value: 'false' },
    ],
  });
  assert.deepEqual(fromGtmPayload('tag', gtm), {
    type: 'customHtml',
    html: '<script>1</script>',
    trigger: [],
    exceptTrigger: [],
  });
});

test('customImage tag maps to GTM "img" type and back', () => {
  const gtm = toGtmPayload('tag', 'pixel', { type: 'customImage', url: 'https://example.com/p.gif' });
  assert.deepEqual(gtm, {
    name: 'pixel',
    type: 'img',
    parameter: [{ type: 'template', key: 'url', value: 'https://example.com/p.gif' }],
  });
  assert.deepEqual(fromGtmPayload('tag', gtm), {
    type: 'customImage',
    url: 'https://example.com/p.gif',
    trigger: [],
    exceptTrigger: [],
  });
});

test('tag firing behavior (priority, firingOption, schedule, setup/teardown) round-trips', () => {
  const gtm = toGtmPayload('tag', 'main', {
    type: 'customHtml',
    html: '<script>1</script>',
    priority: 5,
    firingOption: 'oncePerEvent',
    scheduleStart: '1700000000000',
    scheduleEnd: '1800000000000',
    setupTags: ['pre'],
    teardownTags: ['post'],
  });
  assert.deepEqual(gtm.priority, { type: 'integer', value: '5' });
  assert.equal(gtm.tagFiringOption, 'oncePerEvent');
  assert.equal(gtm.scheduleStartMs, '1700000000000');
  assert.equal(gtm.scheduleEndMs, '1800000000000');
  assert.deepEqual(gtm.setupTag, [{ tagName: 'pre', stopOnSetupFailure: true }]);
  assert.deepEqual(gtm.teardownTag, [{ tagName: 'post' }]);
  assert.deepEqual(fromGtmPayload('tag', gtm), {
    type: 'customHtml',
    html: '<script>1</script>',
    trigger: [],
    exceptTrigger: [],
    priority: 5,
    firingOption: 'oncePerEvent',
    scheduleStart: '1700000000000',
    scheduleEnd: '1800000000000',
    setupTags: ['pre'],
    teardownTags: ['post'],
  });
});

test('oncePerPage firing option round-trips to GTM\'s ONCE_PER_LOAD', () => {
  const gtm = toGtmPayload('tag', 'main', { type: 'customHtml', html: '<script>1</script>', firingOption: 'oncePerPage' });
  assert.equal(gtm.tagFiringOption, 'oncePerLoad');
  assert.equal(fromGtmPayload('tag', gtm).firingOption, 'oncePerPage');
});

test('tag consent (needed, with types) round-trips', () => {
  const gtm = toGtmPayload('tag', 'main', {
    type: 'customHtml',
    html: '<script>1</script>',
    consent: { status: 'needed', types: ['ad_storage', 'analytics_storage'] },
  });
  assert.deepEqual(gtm.consentSettings, {
    consentStatus: 'needed',
    consentType: { type: 'list', list: [{ type: 'template', value: 'ad_storage' }, { type: 'template', value: 'analytics_storage' }] },
  });
  assert.deepEqual(fromGtmPayload('tag', gtm), {
    type: 'customHtml',
    html: '<script>1</script>',
    trigger: [],
    exceptTrigger: [],
    consent: { status: 'needed', types: ['ad_storage', 'analytics_storage'] },
  });
});

test('tag consent (notNeeded) round-trips without a types list', () => {
  const gtm = toGtmPayload('tag', 'main', { type: 'customHtml', html: '<script>1</script>', consent: { status: 'notNeeded' } });
  assert.deepEqual(gtm.consentSettings, { consentStatus: 'notNeeded' });
  assert.deepEqual(fromGtmPayload('tag', gtm).consent, { status: 'notNeeded' });
});

test('a tag with no consent declared has no consentSettings and no drift from GTM\'s default notSet', () => {
  const gtm = toGtmPayload('tag', 'main', { type: 'customHtml', html: '<script>1</script>' });
  assert.equal(gtm.consentSettings, undefined);
  // GTM stamps every tag with consentSettings: {consentStatus: 'notSet'} even when it wasn't sent.
  assert.equal(fromGtmPayload('tag', { ...gtm, consentSettings: { consentStatus: 'notSet' } }).consent, undefined);
});

test('consentInit trigger maps as a bare type', () => {
  const gtm = toGtmPayload('trigger', 'consent-init', { type: 'consentInit' });
  assert.deepEqual(gtm, { name: 'consent-init', type: 'consentInit' });
  assert.deepEqual(fromGtmPayload('trigger', gtm), { type: 'consentInit' });
});

test('unknown type throws rather than silently producing a bad payload', () => {
  assert.throws(() => toGtmPayload('tag', 'x', { type: 'somethingElse' }), /No GTM payload mapping/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseYaml } from './parser.js';
import { validateConfig } from './schema.js';
import { ConfigError } from './errors.js';

const HEADER = `
version: 1
project:
  name: test
google:
  gtm:
    accountId: "1"
    containerId: "1"
  ga4:
    propertyId: "1"
`;

function validate(yaml: string) {
  const parsed = parseYaml('analytics.yaml', HEADER + yaml);
  return validateConfig(parsed);
}

test('a ga4Event tag with no consent block fails validation', () => {
  const yaml = `
gtm:
  triggers:
    lead_trigger: { type: customEvent, eventName: generate_lead }
  tags:
    generate_lead: { type: ga4Event, eventName: generate_lead, trigger: [lead_trigger], parameters: {} }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('a ga4Event tag that declares consent passes validation', () => {
  const yaml = `
gtm:
  triggers:
    lead_trigger: { type: customEvent, eventName: generate_lead }
  tags:
    generate_lead:
      type: ga4Event
      eventName: generate_lead
      trigger: [lead_trigger]
      parameters: {}
      consent: { status: notNeeded }
`;
  const config = validate(yaml);
  assert.deepEqual(config.gtm.tags.generate_lead.consent, { status: 'notNeeded' });
});

test('a customHtml tag needs no consent block (not on the consent-needing type list)', () => {
  const yaml = `
gtm:
  tags:
    tracker: { type: customHtml, html: "<script></script>" }
`;
  assert.doesNotThrow(() => validate(yaml));
});

test('consent status "needed" requires a non-empty types list', () => {
  const yaml = `
gtm:
  tags:
    tracker: { type: customHtml, html: "<script></script>", consent: { status: needed } }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('consent status "notNeeded" rejects a types list', () => {
  const yaml = `
gtm:
  tags:
    tracker: { type: customHtml, html: "<script></script>", consent: { status: notNeeded, types: [ad_storage] } }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('an event parameter named "email" fails PII lint', () => {
  const yaml = `
events:
  signup:
    parameters:
      email: { type: string }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('an event parameter named "form" passes PII lint', () => {
  const yaml = `
events:
  generate_lead:
    parameters:
      form: { type: string }
    consent: { status: notNeeded }
`;
  assert.doesNotThrow(() => validate(yaml));
});

test('a resource can be marked protected: true', () => {
  const yaml = `
gtm:
  tags:
    checkout_pixel: { type: customHtml, html: "<script></script>", protected: true }
`;
  const config = validate(yaml);
  assert.equal(config.gtm.tags.checkout_pixel.protected, true);
});

test('protected must be a boolean', () => {
  const yaml = `
gtm:
  tags:
    checkout_pixel: { type: customHtml, html: "<script></script>", protected: "yes" }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

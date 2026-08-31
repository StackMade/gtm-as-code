import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnalyticsConfig } from '../config/schema.js';
import { compileEvents, toResources } from './compile.js';
import { buildDependencyGraph } from './graph.js';
import { ConfigError } from '../config/errors.js';

function baseConfig(overrides: Partial<AnalyticsConfig>): AnalyticsConfig {
  return {
    version: 1,
    project: { name: 'test' },
    google: { gtm: { accountId: '1', containerId: '1' }, ga4: { propertyId: '1' } },
    events: {},
    gtm: { variables: {}, triggers: {}, tags: {}, folders: {}, builtInVariables: [] },
    ga4: { dimensions: {}, metrics: {}, keyEvents: {}, audiences: {}, eventCreateRules: {}, eventEditRules: {}, calculatedMetrics: {}, channelGroups: {}, measurementProtocolSecrets: {}, },
    ...overrides,
  };
}

// The worked example from the README: one event, its parameters, and everything it expands to.
const generateLeadConfig = baseConfig({
  events: {
    generate_lead: {
      description: 'Contact form submitted',
      keyEvent: true,
      parameters: {
        form: { type: 'string', dimension: true },
        source: { type: 'string', optional: true },
      },
      consent: { status: 'needed', types: ['analytics_storage'] },
    },
  },
});

test('the worked example produces exactly the expected GTM resources', () => {
  const compiled = compileEvents(generateLeadConfig, 'analytics.yaml');

  assert.deepEqual(Object.keys(compiled.gtm.variables).sort(), ['form', 'source']);
  assert.deepEqual(compiled.gtm.variables.form, { type: 'dataLayerVariable', variableName: 'form' });
  assert.deepEqual(compiled.gtm.variables.source, { type: 'dataLayerVariable', variableName: 'source' });

  assert.deepEqual(Object.keys(compiled.gtm.triggers), ['generate_lead']);
  assert.deepEqual(compiled.gtm.triggers.generate_lead, { type: 'customEvent', eventName: 'generate_lead' });

  assert.deepEqual(Object.keys(compiled.gtm.tags), ['generate_lead']);
  assert.deepEqual(compiled.gtm.tags.generate_lead, {
    type: 'ga4Event',
    eventName: 'generate_lead',
    trigger: ['generate_lead'],
    parameters: { form: '{{form}}', source: '{{source}}' },
    consent: { status: 'needed', types: ['analytics_storage'] },
  });
});

test('the worked example produces exactly the expected GA4 resources', () => {
  const compiled = compileEvents(generateLeadConfig, 'analytics.yaml');

  assert.deepEqual(Object.keys(compiled.ga4.dimensions), ['form']);
  assert.deepEqual(compiled.ga4.dimensions.form, { scope: 'event', parameter: 'form' });

  assert.deepEqual(Object.keys(compiled.ga4.keyEvents), ['generate_lead']);
});

test('explicit gtm primitive with the same id as a derived one wins (escape hatch)', () => {
  const config = baseConfig({
    events: {
      generate_lead: { parameters: { form: { type: 'string' } }, consent: { status: 'notNeeded' } },
    },
    gtm: {
      variables: { form: { type: 'dataLayerVariable', variableName: 'form', defaultValue: 'n/a' } },
      triggers: {},
      tags: {},
      folders: {},
      builtInVariables: [],
    },
  });

  const compiled = compileEvents(config, 'analytics.yaml');

  assert.deepEqual(compiled.gtm.variables.form, {
    type: 'dataLayerVariable',
    variableName: 'form',
    defaultValue: 'n/a',
  });
});

test('an event with no consent declared throws (its ga4Event tag would fire with no consent guard)', () => {
  const config = baseConfig({ events: { generate_lead: { parameters: {} } } });
  assert.throws(() => compileEvents(config, 'analytics.yaml'), ConfigError);
});

test('an event explicitly waiving consent (notNeeded) compiles without throwing', () => {
  const config = baseConfig({
    events: { generate_lead: { parameters: {}, consent: { status: 'notNeeded' } } },
  });
  const compiled = compileEvents(config, 'analytics.yaml');
  assert.deepEqual(compiled.gtm.tags.generate_lead.consent, { status: 'notNeeded' });
});

test('more than 50 event-scoped custom dimensions (hand-written + event-derived) throws', () => {
  const dimensions: AnalyticsConfig['ga4']['dimensions'] = {};
  for (let i = 0; i < 51; i++) dimensions[`dim_${i}`] = { scope: 'event', parameter: `dim_${i}` };
  const config = baseConfig({ ga4: { dimensions, metrics: {}, keyEvents: {}, audiences: {}, eventCreateRules: {}, eventEditRules: {}, calculatedMetrics: {}, channelGroups: {}, measurementProtocolSecrets: {}, } });

  assert.throws(() => compileEvents(config, 'analytics.yaml'), ConfigError);
});

test('exactly 50 event-scoped custom dimensions compiles without throwing', () => {
  const dimensions: AnalyticsConfig['ga4']['dimensions'] = {};
  for (let i = 0; i < 50; i++) dimensions[`dim_${i}`] = { scope: 'event', parameter: `dim_${i}` };
  const config = baseConfig({ ga4: { dimensions, metrics: {}, keyEvents: {}, audiences: {}, eventCreateRules: {}, eventEditRules: {}, calculatedMetrics: {}, channelGroups: {}, measurementProtocolSecrets: {}, } });

  assert.doesNotThrow(() => compileEvents(config, 'analytics.yaml'));
});

test('user-scoped custom dimensions do not count toward the event-scoped cap', () => {
  const dimensions: AnalyticsConfig['ga4']['dimensions'] = {};
  for (let i = 0; i < 60; i++) dimensions[`dim_${i}`] = { scope: 'user', parameter: `dim_${i}` };
  const config = baseConfig({ ga4: { dimensions, metrics: {}, keyEvents: {}, audiences: {}, eventCreateRules: {}, eventEditRules: {}, calculatedMetrics: {}, channelGroups: {}, measurementProtocolSecrets: {}, } });

  assert.doesNotThrow(() => compileEvents(config, 'analytics.yaml'));
});

test('derived id colliding with an unrelated explicit resource in another section throws', () => {
  const config = baseConfig({
    events: {
      generate_lead: { parameters: {} },
    },
    ga4: { dimensions: { generate_lead: { scope: 'event', parameter: 'unrelated' } }, metrics: {}, keyEvents: {}, audiences: {}, eventCreateRules: {}, eventEditRules: {}, calculatedMetrics: {}, channelGroups: {}, measurementProtocolSecrets: {}, },
  });

  assert.throws(() => compileEvents(config, 'analytics.yaml'), ConfigError);
});

test('same parameter reused across events derives one shared DLV, not a collision', () => {
  const config = baseConfig({
    events: {
      generate_lead: { parameters: { source: { type: 'string' } }, consent: { status: 'notNeeded' } },
      purchase: { parameters: { source: { type: 'string' } }, consent: { status: 'notNeeded' } },
    },
  });

  const compiled = compileEvents(config, 'analytics.yaml');

  assert.deepEqual(Object.keys(compiled.gtm.variables), ['source']);
});

test('compiled config feeds the dependency graph: variable -> trigger -> tag', () => {
  const compiled = compileEvents(generateLeadConfig, 'analytics.yaml');
  const order = buildDependencyGraph(compiled).topologicalOrder();

  assert.ok(order.indexOf('variable:form') < order.indexOf('tag:generate_lead'));
  assert.ok(order.indexOf('trigger:generate_lead') < order.indexOf('tag:generate_lead'));
});

test('toResources flattens a compiled config into the generic Resource model', () => {
  const compiled = compileEvents(generateLeadConfig, 'analytics.yaml');
  const resources = toResources(compiled);

  const tag = resources.find((resource) => resource.id === 'generate_lead' && resource.type === 'gtm.tag');
  assert.ok(tag);
  assert.equal(tag?.provider, 'google');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnalyticsConfig } from '../config/schema.js';
import { generateDataDictionary } from './docs.js';

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

test('generateDataDictionary lists events alphabetically with a heading each', () => {
  const config = baseConfig({
    events: {
      generate_lead: { parameters: {} },
      add_to_cart: { parameters: {} },
    },
  });

  const markdown = generateDataDictionary(config);
  assert.ok(markdown.indexOf('## add_to_cart') < markdown.indexOf('## generate_lead'));
});

test('generateDataDictionary renders description, key event flag, and consent', () => {
  const config = baseConfig({
    events: {
      generate_lead: {
        description: 'Contact form submitted',
        keyEvent: true,
        consent: { status: 'needed', types: ['analytics_storage'] },
        parameters: {},
      },
    },
  });

  const markdown = generateDataDictionary(config);
  assert.match(markdown, /Contact form submitted/);
  assert.match(markdown, /key event/);
  assert.match(markdown, /consent: needed \(analytics_storage\)/);
});

test('generateDataDictionary renders a parameter table with type, required, and dimension columns', () => {
  const config = baseConfig({
    events: {
      generate_lead: {
        parameters: {
          form: { type: 'string', dimension: true },
          source: { type: 'string', optional: true },
        },
      },
    },
  });

  const markdown = generateDataDictionary(config);
  assert.match(markdown, /\| form \| string \| yes \| yes \|/);
  assert.match(markdown, /\| source \| string \| no \| no \|/);
});

test('generateDataDictionary notes when an event has no parameters', () => {
  const config = baseConfig({ events: { page_ready: { parameters: {} } } });
  assert.match(generateDataDictionary(config), /No parameters\./);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AnalyticsConfig } from '../config/schema.js';
import { generateEventTypes } from './generate.js';

function baseConfig(overrides: Partial<AnalyticsConfig>): AnalyticsConfig {
  return {
    version: 1,
    project: { name: 'test' },
    google: { gtm: { accountId: '1', containerId: '1' }, ga4: { propertyId: '1' } },
    events: {},
    gtm: { variables: {}, triggers: {}, tags: {}, folders: {}, builtInVariables: [], environments: {} },
    ga4: { dimensions: {}, metrics: {}, keyEvents: {}, audiences: {}, eventCreateRules: {}, eventEditRules: {}, calculatedMetrics: {}, channelGroups: {}, measurementProtocolSecrets: {}, },
    ...overrides,
  };
}

test('generateEventTypes emits an EventName union and a params interface per event', () => {
  const config = baseConfig({
    events: {
      generate_lead: {
        parameters: {
          form: { type: 'string' },
          value: { type: 'number', optional: true },
        },
      },
      add_to_cart: { parameters: {} },
    },
  });

  const source = generateEventTypes(config);
  assert.match(source, /export type EventName = 'add_to_cart' \| 'generate_lead';/);
  assert.match(source, /export interface GenerateLeadParams \{/);
  assert.match(source, /form: string;/);
  assert.match(source, /value\?: number;/);
  assert.match(source, /export interface AddToCartParams \{/);
  assert.match(source, /generate_lead: GenerateLeadParams;/);
  assert.match(source, /add_to_cart: AddToCartParams;/);
});

test('generateEventTypes emits a track() function typed over EventParams', () => {
  const source = generateEventTypes(baseConfig({}));
  assert.match(source, /export function track<E extends EventName>\(event: E, params: EventParams\[E\]\): void \{/);
  assert.match(source, /window\.dataLayer\.push\(\{ event, \.\.\.params \}\);/);
});

test('generateEventTypes handles a config with no events', () => {
  const source = generateEventTypes(baseConfig({}));
  assert.match(source, /export type EventName = never;/);
  assert.match(source, /export interface EventParams \{\}/);
});

test('generateEventTypes emits an Item interface and Item[] field for a type: items parameter', () => {
  const config = baseConfig({
    events: {
      purchase: {
        parameters: {
          currency: { type: 'string' },
          items: { type: 'items' },
        },
      },
    },
  });

  const source = generateEventTypes(config);
  assert.match(source, /export interface Item \{/);
  assert.match(source, /item_id\?: string;/);
  assert.match(source, /items: Item\[\];/);
});

test('generateEventTypes omits the Item interface when no event uses type: items', () => {
  const source = generateEventTypes(baseConfig({ events: { add_to_cart: { parameters: {} } } }));
  assert.doesNotMatch(source, /export interface Item \{/);
});

test('generated helpers compile and retain distinct parameter types for colliding and reserved names', () => {
  const source = generateEventTypes(baseConfig({ events: {
    foo_bar: { parameters: { amount: { type: 'number' } } },
    foo__bar: { parameters: { amount: { type: 'string' } } },
    event: { parameters: { value: { type: 'boolean' } } },
  } }));
  const dir = mkdtempSync(join(tmpdir(), 'gtm-generated-types-'));
  const file = join(dir, 'events.ts');
  writeFileSync(file, source + `
track('foo_bar', { amount: 42 });
track('foo__bar', { amount: '42' });
track('event', { value: true });
// @ts-expect-error distinct event parameter types must not merge
track('foo_bar', { amount: 'wrong' });
// @ts-expect-error distinct event parameter types must not merge
track('foo__bar', { amount: 42 });
`);
  execFileSync(resolve('node_modules/.bin/tsc'), ['--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--lib', 'es2022,dom', file], { stdio: 'pipe' });
});

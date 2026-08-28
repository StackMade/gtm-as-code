import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnalyticsConfig } from '../config/schema.js';
import { buildDependencyGraph, CircularDependencyError } from './graph.js';

function baseConfig(overrides: Partial<AnalyticsConfig['gtm']>): AnalyticsConfig {
  return {
    version: 1,
    project: { name: 'test' },
    google: { gtm: { accountId: '1', containerId: '1' }, ga4: { propertyId: '1' } },
    events: {},
    gtm: { variables: {}, triggers: {}, tags: {}, folders: {}, builtInVariables: [], ...overrides },
    ga4: { dimensions: {}, metrics: {}, keyEvents: {} },
  };
}

test('tag -> trigger -> variable resolves in dependency order', () => {
  const config = baseConfig({
    variables: { consent: { type: 'firstPartyCookie', settings: { cookieName: 'c' } } },
    triggers: { accepted: { type: 'customEvent', eventName: '{{consent}}' } },
    tags: { conversion: { type: 'ga4Event', trigger: ['accepted'] } },
  });

  const order = buildDependencyGraph(config).topologicalOrder();

  assert.ok(order.indexOf('variable:consent') < order.indexOf('trigger:accepted'));
  assert.ok(order.indexOf('trigger:accepted') < order.indexOf('tag:conversion'));
});

test('setupTags/teardownTags order a tag before/after the tags it references', () => {
  const config = baseConfig({
    tags: {
      pre: { type: 'customHtml', html: '1' },
      main: { type: 'customHtml', html: '2', setupTags: ['pre'], teardownTags: ['post'] },
      post: { type: 'customHtml', html: '3' },
    },
  });

  const order = buildDependencyGraph(config).topologicalOrder();

  assert.ok(order.indexOf('tag:pre') < order.indexOf('tag:main'));
  assert.ok(order.indexOf('tag:main') < order.indexOf('tag:post'));
});

test('a setupTag cycle between two tags throws a descriptive error', () => {
  const config = baseConfig({
    tags: {
      a: { type: 'customHtml', html: '1', setupTags: ['b'] },
      b: { type: 'customHtml', html: '2', setupTags: ['a'] },
    },
  });

  assert.throws(
    () => buildDependencyGraph(config).topologicalOrder(),
    (error: unknown) => {
      assert.ok(error instanceof CircularDependencyError);
      return true;
    },
  );
});

test('circular reference throws a descriptive error', () => {
  const config = baseConfig({
    variables: {
      a: { type: 'jsVariable', code: '{{b}}' },
      b: { type: 'jsVariable', code: '{{a}}' },
    },
  });

  assert.throws(
    () => buildDependencyGraph(config).topologicalOrder(),
    (error: unknown) => {
      assert.ok(error instanceof CircularDependencyError);
      assert.match(error.message, /Circular dependency detected/);
      return true;
    },
  );
});

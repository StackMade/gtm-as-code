import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './loader.js';
import { locateLine, locateFile } from './parser.js';
import { ConfigError } from './errors.js';

const ROOT_HEADER = `
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

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'gtm-as-code-loader-'));
}

test('loadConfig merges events from an extends: target into the root config', () => {
  const dir = tempDir();
  writeFileSync(
    join(dir, 'pack.yaml'),
    'events:\n  add_to_cart:\n    parameters:\n      value:\n        type: number\n',
  );
  writeFileSync(join(dir, 'analytics.yaml'), `${ROOT_HEADER}extends: pack.yaml\nevents:\n  generate_lead:\n    parameters: {}\n`);

  const parsed = loadConfig(join(dir, 'analytics.yaml'));
  const data = parsed.data as { events: Record<string, unknown>; extends?: unknown };

  assert.deepEqual(Object.keys(data.events).sort(), ['add_to_cart', 'generate_lead']);
  assert.equal(data.extends, undefined);
});

test('loadConfig resolves multiple extends targets and an include of an include', () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'base.yaml'), 'events:\n  page_ready:\n    parameters: {}\n');
  writeFileSync(join(dir, 'ecommerce.yaml'), 'extends: base.yaml\nevents:\n  add_to_cart:\n    parameters: {}\n');
  writeFileSync(join(dir, 'analytics.yaml'), `${ROOT_HEADER}extends: [ecommerce.yaml]\nevents:\n  generate_lead:\n    parameters: {}\n`);

  const parsed = loadConfig(join(dir, 'analytics.yaml'));
  const data = parsed.data as { events: Record<string, unknown> };
  assert.deepEqual(Object.keys(data.events).sort(), ['add_to_cart', 'generate_lead', 'page_ready']);
});

test('loadConfig lets a root event win over the same event defined in an extends target', () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'pack.yaml'), 'events:\n  generate_lead:\n    parameters:\n      from_pack:\n        type: string\n');
  writeFileSync(join(dir, 'analytics.yaml'), `${ROOT_HEADER}extends: pack.yaml\nevents:\n  generate_lead:\n    parameters: {}\n`);

  assert.throws(() => loadConfig(join(dir, 'analytics.yaml')), ConfigError);
});

test('loadConfig throws when two extends targets define the same event', () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'a.yaml'), 'events:\n  generate_lead:\n    parameters: {}\n');
  writeFileSync(join(dir, 'b.yaml'), 'events:\n  generate_lead:\n    parameters: {}\n');
  writeFileSync(join(dir, 'analytics.yaml'), `${ROOT_HEADER}extends: [a.yaml, b.yaml]\n`);

  assert.throws(() => loadConfig(join(dir, 'analytics.yaml')), ConfigError);
});

test('loadConfig rejects an extends target that sets identity/credential fields', () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'pack.yaml'), 'google:\n  gtm:\n    accountId: "9"\n');
  writeFileSync(join(dir, 'analytics.yaml'), `${ROOT_HEADER}extends: pack.yaml\n`);

  assert.throws(() => loadConfig(join(dir, 'analytics.yaml')), ConfigError);
});

test('loadConfig rejects an extends target that sets gtm.builtInVariables', () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'pack.yaml'), 'gtm:\n  builtInVariables: [clickUrl]\n');
  writeFileSync(join(dir, 'analytics.yaml'), `${ROOT_HEADER}extends: pack.yaml\n`);

  assert.throws(() => loadConfig(join(dir, 'analytics.yaml')), ConfigError);
});

test('loadConfig throws on a circular extends chain', () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'a.yaml'), 'extends: analytics.yaml\nevents:\n  a_event:\n    parameters: {}\n');
  writeFileSync(join(dir, 'analytics.yaml'), `${ROOT_HEADER}extends: a.yaml\n`);

  assert.throws(() => loadConfig(join(dir, 'analytics.yaml')), ConfigError);
});

test('loadConfig throws when an extends target does not exist', () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'analytics.yaml'), `${ROOT_HEADER}extends: missing.yaml\n`);

  assert.throws(() => loadConfig(join(dir, 'analytics.yaml')), ConfigError);
});

test('a merged config points errors on an included event at the included file, not the root', () => {
  const dir = tempDir();
  mkdirSync(join(dir, 'packs'));
  writeFileSync(join(dir, 'packs', 'pack.yaml'), 'events:\n  add_to_cart:\n    parameters:\n      value:\n        type: number\n');
  writeFileSync(join(dir, 'analytics.yaml'), `${ROOT_HEADER}extends: packs/pack.yaml\nevents: {}\n`);

  const parsed = loadConfig(join(dir, 'analytics.yaml'));
  const path = ['events', 'add_to_cart', 'parameters', 'value', 'type'];

  assert.equal(locateFile(parsed, path), join(dir, 'packs', 'pack.yaml'));
  assert.equal(locateLine(parsed, path), 5);
});

test('a config with no extends: is unaffected (no origins map, unchanged data)', () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'analytics.yaml'), `${ROOT_HEADER}events:\n  generate_lead:\n    parameters: {}\n`);

  const parsed = loadConfig(join(dir, 'analytics.yaml'));
  assert.equal(parsed.origins, undefined);
});

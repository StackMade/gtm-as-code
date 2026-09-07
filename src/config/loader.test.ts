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

const ENVIRONMENTS_BLOCK = `environments:
  staging:
    google:
      gtm:
        containerId: "222"
      ga4:
        propertyId: "22"
    ga4:
      streamWebsiteUrl: "https://staging.example.com"
  production:
    google:
      gtm:
        containerId: "333"
      ga4:
        propertyId: "33"
`;

function withEnvironments(dir: string, block: string = ENVIRONMENTS_BLOCK): string {
  const file = join(dir, 'analytics.yaml');
  writeFileSync(file, `${ROOT_HEADER}${block}`);
  return file;
}

test('loadConfig merges the selected environment over the root config and drops the block', () => {
  const file = withEnvironments(tempDir());

  const parsed = loadConfig(file, 'staging');
  const data = parsed.data as {
    google: { gtm: { accountId: string; containerId: string }; ga4: { propertyId: string } };
    ga4: { streamWebsiteUrl: string };
    environments?: unknown;
  };

  assert.equal(data.google.gtm.containerId, '222');
  assert.equal(data.google.ga4.propertyId, '22');
  assert.equal(data.ga4.streamWebsiteUrl, 'https://staging.example.com');
  // Untouched by the environment, so it still comes from the root.
  assert.equal(data.google.gtm.accountId, '1');
  assert.equal(data.environments, undefined);
});

test('loadConfig leaves the root config alone when a different environment is selected', () => {
  const file = withEnvironments(tempDir());

  const production = loadConfig(file, 'production').data as {
    google: { gtm: { containerId: string } };
    ga4?: { streamWebsiteUrl?: string };
  };

  assert.equal(production.google.gtm.containerId, '333');
  // `staging` sets this and `production` does not, so selecting production must not inherit it.
  assert.equal(production.ga4?.streamWebsiteUrl, undefined);
});

test('loadConfig refuses to guess an environment and lists the declared ones', () => {
  const file = withEnvironments(tempDir());

  assert.throws(
    () => loadConfig(file),
    (error: unknown) => error instanceof ConfigError && /staging, production/.test(String(error.message ?? error)),
  );
});

test('loadConfig names the declared environments when the selected one does not exist', () => {
  const file = withEnvironments(tempDir());

  assert.throws(
    () => loadConfig(file, 'prod'),
    (error: unknown) => error instanceof ConfigError && /staging, production/.test(String(error.message ?? error)),
  );
});

test('loadConfig rejects an environment overriding something that is not per-environment', () => {
  const file = withEnvironments(
    tempDir(),
    'environments:\n  staging:\n    events:\n      generate_lead:\n        parameters: {}\n',
  );

  assert.throws(() => loadConfig(file, 'staging'), ConfigError);
});

test('loadConfig rejects --env against a config with no environments block', () => {
  const dir = tempDir();
  const file = join(dir, 'analytics.yaml');
  writeFileSync(file, ROOT_HEADER);

  assert.throws(() => loadConfig(file, 'staging'), ConfigError);
});

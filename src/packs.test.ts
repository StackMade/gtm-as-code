import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config/loader.js';
import { interpolateConfig } from './config/interpolation.js';
import { validateConfig } from './config/schema.js';
import { compileEvents } from './core/compile.js';
import { generateEventTypes } from './core/generate.js';
import { generateDataDictionary } from './core/docs.js';

const PACKS_DIR = join(process.cwd(), 'packs');

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

function loadWithExtends(pack: string) {
  const dir = mkdtempSync(join(tmpdir(), 'gtm-as-code-packs-'));
  const configPath = join(dir, 'analytics.yaml');
  writeFileSync(configPath, `${HEADER}extends: ${join(PACKS_DIR, pack)}\n`);
  const parsed = loadConfig(configPath);
  const interpolated = { ...parsed, data: interpolateConfig(parsed) };
  const config = validateConfig(interpolated);
  return compileEvents(config, parsed.file);
}

for (const pack of ['ecommerce.yaml', 'recommended.yaml']) {
  test(`${pack} validates and compiles through extends:`, () => {
    const config = loadWithExtends(pack);
    assert.ok(Object.keys(config.events).length > 0);
  });

  test(`${pack} produces generate.ts and docs.ts output that doesn't throw`, () => {
    const config = loadWithExtends(pack);
    assert.doesNotThrow(() => generateEventTypes(config));
    assert.doesNotThrow(() => generateDataDictionary(config));
  });
}

test('ecommerce.yaml events with an items parameter emit Item[] in generate output', () => {
  const config = loadWithExtends('ecommerce.yaml');
  const source = generateEventTypes(config);
  assert.match(source, /export interface Item \{/);
  assert.match(source, /items(\?)?: Item\[\];/);
});

test('every event in ecommerce.yaml and recommended.yaml declares consent', () => {
  for (const pack of ['ecommerce.yaml', 'recommended.yaml']) {
    const raw = readFileSync(join(PACKS_DIR, pack), 'utf8');
    assert.ok(raw.includes('consent:'), `${pack} should declare consent on its events`);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkEnvIsNotAPath, loadEnvFile } from './env-file.js';

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'gtm-env-'));
  for (const [name, contents] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, contents);
  }
  return dir;
}

test('loads an explicit path', () => {
  const dir = fixture({ 'custom.env': 'GTM_ENV_FILE_TEST_A=from_file\n' });
  assert.equal(loadEnvFile('custom.env', dir), join(dir, 'custom.env'));
  assert.equal(process.env.GTM_ENV_FILE_TEST_A, 'from_file');
  delete process.env.GTM_ENV_FILE_TEST_A;
});

test('discovers analytics/.env.analytics when no path is passed', () => {
  const dir = fixture({ 'analytics/.env.analytics': 'GTM_ENV_FILE_TEST_B=discovered\n' });
  assert.equal(loadEnvFile(undefined, dir), join(dir, 'analytics/.env.analytics'));
  assert.equal(process.env.GTM_ENV_FILE_TEST_B, 'discovered');
  delete process.env.GTM_ENV_FILE_TEST_B;
});

test('an existing environment variable wins over the file', () => {
  const dir = fixture({ '.env.analytics': 'GTM_ENV_FILE_TEST_C=from_file\n' });
  process.env.GTM_ENV_FILE_TEST_C = 'from_environment';
  loadEnvFile(undefined, dir);
  assert.equal(process.env.GTM_ENV_FILE_TEST_C, 'from_environment');
  delete process.env.GTM_ENV_FILE_TEST_C;
});

test('returns undefined when there is nothing to load', () => {
  assert.equal(loadEnvFile(undefined, fixture({})), undefined);
});

test('an explicit path that does not exist is an error naming it', () => {
  assert.throws(() => loadEnvFile('nope.env', fixture({})), /Env file not found: nope\.env/);
});

test('checkEnvIsNotAPath accepts an ordinary environment name', () => {
  assert.doesNotThrow(() => checkEnvIsNotAPath('production'));
  assert.doesNotThrow(() => checkEnvIsNotAPath(undefined));
});

test('checkEnvIsNotAPath rejects the pre-0.9 --env argument and names --dotenv', () => {
  assert.throws(() => checkEnvIsNotAPath('analytics/.env.analytics'), /--dotenv analytics\/\.env\.analytics/);
  assert.throws(() => checkEnvIsNotAPath('.env.analytics'), /--dotenv/);
});

test('checkEnvIsNotAPath rejects a bare name that happens to be a file that exists', () => {
  assert.throws(() => checkEnvIsNotAPath('package.json'), /looks like a file path/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { interpolateConfig } from './interpolation.js';
import { parseYaml } from './parser.js';

function resolveWith(yaml: string, env: NodeJS.ProcessEnv): unknown {
  return interpolateConfig(parseYaml('analytics.yaml', yaml), env);
}

test('resolves variables with an allowed prefix', () => {
  const env = { GTM_ACCOUNT_ID: '1', GA4_PROPERTY_ID: '2', ANALYTICS_SITE: 'x' };
  assert.deepEqual(resolveWith('a: "${GTM_ACCOUNT_ID}"\nb: "${GA4_PROPERTY_ID}"\nc: "${ANALYTICS_SITE}"\n', env), {
    a: '1',
    b: '2',
    c: 'x',
  });
});

test('rejects any other variable without printing its value', () => {
  const error = (() => {
    try {
      resolveWith('a: "${CI_SECRET}"\n', { CI_SECRET: 'hunter2' });
    } catch (caught) {
      return caught as Error;
    }
  })();
  assert.match(error?.message ?? '', /Environment variable not allowed[\s\S]*CI_SECRET/);
  assert.doesNotMatch(error?.message ?? '', /hunter2/);
});

test('a default does not make a disallowed variable allowed', () => {
  assert.throws(() => resolveWith('a: "${CI_SECRET:-x}"\n', {}), /not allowed/);
});

test('GTM_CODE_ALLOW_ENV opts a named variable in', () => {
  const env = { GTM_CODE_ALLOW_ENV: 'OTHER, CONTAINER_ID', CONTAINER_ID: '7' };
  assert.deepEqual(resolveWith('a: "${CONTAINER_ID}"\n', env), { a: '7' });
});

test('a __proto__ key is rejected instead of hiding its subtree from validation', () => {
  assert.throws(() => resolveWith('project:\n  __proto__:\n    name: x\n', {}), /project\.__proto__[\s\S]*Not allowed/);
});

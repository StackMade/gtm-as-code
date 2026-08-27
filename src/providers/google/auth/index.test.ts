import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeAuthFailure } from './index.js';

test('missing ADC maps to actionable local/CI guidance', () => {
  const message = describeAuthFailure(new Error('Could not load the default credentials.'));
  assert.match(message, /gcloud auth application-default login/);
  assert.match(message, /GOOGLE_APPLICATION_CREDENTIALS/);
});

test('invalid_grant maps to a re-login hint', () => {
  const message = describeAuthFailure(new Error("invalid_grant: Account has been deleted"));
  assert.match(message, /expired or revoked/);
});

test('unrecognized failure still returns the underlying message, not the raw error object', () => {
  const message = describeAuthFailure(new Error('unexpected 503 from token endpoint'));
  assert.equal(message, 'Google authentication failed: unexpected 503 from token endpoint');
});

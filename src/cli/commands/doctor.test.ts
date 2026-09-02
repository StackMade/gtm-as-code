import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyGoogleApiError, quotaCheck, renderMarkdown, type DoctorCheck } from './doctor.js';

function apiErrorWithCause(message: string): Error {
  const raw = { response: { data: { error: { status: 'PERMISSION_DENIED', message } } } };
  return new Error('wrapped', { cause: raw });
}

test('classifyGoogleApiError recognizes a disabled API from the raw message under .cause', () => {
  const error = apiErrorWithCause('Analytics Data API has not been used in project 123 before or it is disabled.');
  assert.match(classifyGoogleApiError(error), /API not enabled/);
});

test('classifyGoogleApiError recognizes a permission failure distinct from a disabled API', () => {
  const error = apiErrorWithCause('The caller does not have permission');
  assert.match(classifyGoogleApiError(error), /Permission denied/);
});

test('classifyGoogleApiError falls back to the raw message for anything else', () => {
  const error = apiErrorWithCause('Property 999 not found');
  assert.equal(classifyGoogleApiError(error), 'Property 999 not found');
});

test('quotaCheck reports ok with no quota info when the response carries none', () => {
  const check = quotaCheck(undefined);
  assert.equal(check.status, 'ok');
});

test('quotaCheck reports ok with plenty of tokens remaining', () => {
  const check = quotaCheck({ tokensPerDay: { consumed: 100, remaining: 900 } });
  assert.equal(check.status, 'ok');
});

test('quotaCheck warns once remaining tokens drop under 10% of the daily total', () => {
  const check = quotaCheck({ tokensPerDay: { consumed: 950, remaining: 50 } });
  assert.equal(check.status, 'warn');
});

test('renderMarkdown renders one table row per check, including warn status', () => {
  const checks: DoctorCheck[] = [
    { name: 'config', status: 'ok', detail: 'analytics/analytics.yaml' },
    { name: 'credentials', status: 'fail', detail: 'no credentials found' },
    { name: 'write scopes (apply)', status: 'warn', detail: 'apply will fail without them.' },
  ];
  const markdown = renderMarkdown(checks);
  assert.match(markdown, /\| config \| ✓ ok \| analytics\/analytics\.yaml \|/);
  assert.match(markdown, /\| credentials \| ✗ fail \| no credentials found \|/);
  assert.match(markdown, /\| write scopes \(apply\) \| ⚠ warn \| apply will fail without them\. \|/);
});

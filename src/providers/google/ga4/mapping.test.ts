import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toGa4Payload, fromGa4Payload } from './mapping.js';

test('dimension maps scope to uppercase and back to lowercase', () => {
  const ga4 = toGa4Payload('dimension', 'lead_type', { scope: 'event', parameter: 'lead_type' });
  assert.deepEqual(ga4, { parameterName: 'lead_type', displayName: 'lead_type', scope: 'EVENT' });
  assert.deepEqual(fromGa4Payload('dimension', ga4), { scope: 'event', parameter: 'lead_type' });
});

test('metric defaults measurementUnit to standard when absent', () => {
  const ga4 = toGa4Payload('metric', 'basket_value', { scope: 'event', parameter: 'basket_value' });
  assert.equal(ga4.measurementUnit, 'STANDARD');
});

test('keyEvent maps the resource id to eventName', () => {
  const ga4 = toGa4Payload('keyEvent', 'generate_lead', {});
  assert.deepEqual(ga4, { eventName: 'generate_lead', countingMethod: 'ONCE_PER_EVENT' });
});

// GA4 requires the top-level filterExpression to be an andGroup of orGroups (confirmed live
// 2026-08-29: a bare leaf at the top, or a non-orGroup child of an andGroup, is rejected). Config
// validation (schema.ts's canonicalizeAudienceFilterExpression) normalizes a bare leaf filter into
// this shape before it ever reaches the mapper, so the mapper itself does a plain 1:1 translation.
test('audience maps a single leaf filter clause (already canonicalized) and back', () => {
  const desiredState = {
    description: 'Visitors who viewed the pricing page',
    membershipDurationDays: 30,
    filterClauses: [
      {
        clauseType: 'INCLUDE',
        scope: 'AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS',
        filter: { and: [{ or: [{ event: { eventName: 'view_pricing' } }] }] },
      },
    ],
  };
  const ga4 = toGa4Payload('audience', 'pricing_viewers', desiredState);
  assert.deepEqual(ga4, {
    displayName: 'pricing_viewers',
    description: 'Visitors who viewed the pricing page',
    membershipDurationDays: 30,
    filterClauses: [
      {
        clauseType: 'INCLUDE',
        simpleFilter: {
          scope: 'AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS',
          filterExpression: { andGroup: { filterExpressions: [{ orGroup: { filterExpressions: [{ eventFilter: { eventName: 'view_pricing' } }] } }] } },
        },
      },
    ],
  });
  assert.deepEqual(fromGa4Payload('audience', ga4), desiredState);
});
test('audience maps a nested and-of-or filter with a not and a numeric filter, and back', () => {
  const desiredState = {
    description: 'Engaged desktop visitors',
    membershipDurationDays: 90,
    exclusionDurationMode: 'EXCLUDE_TEMPORARILY',
    eventTrigger: { eventName: 'join_audience', logCondition: 'AUDIENCE_JOINED' },
    filterClauses: [
      {
        clauseType: 'INCLUDE',
        scope: 'AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS',
        filter: {
          and: [
            { or: [{ dimensionOrMetric: { fieldName: 'sessionCount', numeric: { operation: 'GREATER_THAN', value: 2 } } }] },
            { or: [{ not: { dimensionOrMetric: { fieldName: 'deviceCategory', string: { matchType: 'EXACT', value: 'desktop' } } } }] },
          ],
        },
      },
    ],
  };
  const ga4 = toGa4Payload('audience', 'engaged_desktop', desiredState);
  assert.deepEqual(ga4, {
    displayName: 'engaged_desktop',
    description: 'Engaged desktop visitors',
    membershipDurationDays: 90,
    eventTrigger: { eventName: 'join_audience', logCondition: 'AUDIENCE_JOINED' },
    exclusionDurationMode: 'EXCLUDE_TEMPORARILY',
    filterClauses: [
      {
        clauseType: 'INCLUDE',
        simpleFilter: {
          scope: 'AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS',
          filterExpression: {
            andGroup: {
              filterExpressions: [
                {
                  orGroup: {
                    filterExpressions: [
                      { dimensionOrMetricFilter: { fieldName: 'sessionCount', numericFilter: { operation: 'GREATER_THAN', value: { int64Value: '2' } } } },
                    ],
                  },
                },
                {
                  orGroup: {
                    filterExpressions: [
                      { notExpression: { dimensionOrMetricFilter: { fieldName: 'deviceCategory', stringFilter: { matchType: 'EXACT', value: 'desktop' } } } },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    ],
  });
  assert.deepEqual(fromGa4Payload('audience', ga4), desiredState);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseYaml } from './parser.js';
import { validateConfig } from './schema.js';
import { ConfigError } from './errors.js';

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

function validate(yaml: string) {
  const parsed = parseYaml('analytics.yaml', HEADER + yaml);
  return validateConfig(parsed);
}

test('a ga4Event tag with no consent block fails validation', () => {
  const yaml = `
gtm:
  triggers:
    lead_trigger: { type: customEvent, eventName: generate_lead }
  tags:
    generate_lead: { type: ga4Event, eventName: generate_lead, trigger: [lead_trigger], parameters: {} }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('a ga4Event tag that declares consent passes validation', () => {
  const yaml = `
gtm:
  triggers:
    lead_trigger: { type: customEvent, eventName: generate_lead }
  tags:
    generate_lead:
      type: ga4Event
      eventName: generate_lead
      trigger: [lead_trigger]
      parameters: {}
      consent: { status: notNeeded }
`;
  const config = validate(yaml);
  assert.deepEqual(config.gtm.tags.generate_lead.consent, { status: 'notNeeded' });
});

test('a customHtml tag needs no consent block (not on the consent-needing type list)', () => {
  const yaml = `
gtm:
  tags:
    tracker: { type: customHtml, html: "<script></script>" }
`;
  assert.doesNotThrow(() => validate(yaml));
});

test('consent status "needed" requires a non-empty types list', () => {
  const yaml = `
gtm:
  tags:
    tracker: { type: customHtml, html: "<script></script>", consent: { status: needed } }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('consent status "notNeeded" rejects a types list', () => {
  const yaml = `
gtm:
  tags:
    tracker: { type: customHtml, html: "<script></script>", consent: { status: notNeeded, types: [ad_storage] } }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('a tag can reference a reserved built-in trigger name without declaring it under gtm.triggers', () => {
  const yaml = `
gtm:
  tags:
    ga4_config:
      type: googleTag
      trigger: ["Initialization - All Pages"]
      consent: { status: notNeeded }
`;
  const config = validate(yaml);
  assert.deepEqual(config.gtm.tags.ga4_config.trigger, ['Initialization - All Pages']);
});

test('an unrecognized trigger name still fails validation, built-in names do not open it up entirely', () => {
  const yaml = `
gtm:
  tags:
    tracker: { type: customHtml, html: "<script></script>", trigger: [does_not_exist] }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('an event parameter named "email" fails PII lint', () => {
  const yaml = `
events:
  signup:
    parameters:
      email: { type: string }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('an event parameter named "form" passes PII lint', () => {
  const yaml = `
events:
  generate_lead:
    parameters:
      form: { type: string }
    consent: { status: notNeeded }
`;
  assert.doesNotThrow(() => validate(yaml));
});

test('a resource can be marked protected: true', () => {
  const yaml = `
gtm:
  tags:
    checkout_pixel: { type: customHtml, html: "<script></script>", protected: true }
`;
  const config = validate(yaml);
  assert.equal(config.gtm.tags.checkout_pixel.protected, true);
});

test('a GA4 dimension can be marked protected: true', () => {
  const yaml = `
ga4:
  dimensions:
    lead_type: { scope: event, parameter: lead_type, protected: true }
`;
  const config = validate(yaml);
  assert.equal(config.ga4.dimensions.lead_type.protected, true);
});

test('a GA4 metric can be marked protected: true', () => {
  const yaml = `
ga4:
  metrics:
    lead_value: { scope: event, parameter: value, protected: true }
`;
  const config = validate(yaml);
  assert.equal(config.ga4.metrics.lead_value.protected, true);
});

test('an event named "page_view" fails GA4 naming lint (reserved event name)', () => {
  const yaml = `
events:
  page_view:
    parameters: {}
    consent: { status: notNeeded }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('an event name over 40 characters fails GA4 naming lint', () => {
  const yaml = `
events:
  ${'a'.repeat(41)}:
    parameters: {}
    consent: { status: notNeeded }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('a parameter named "user_id" fails GA4 naming lint (reserved parameter name)', () => {
  const yaml = `
events:
  generate_lead:
    parameters:
      user_id: { type: string }
    consent: { status: notNeeded }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('a parameter name starting with "ga_" fails GA4 naming lint (reserved prefix)', () => {
  const yaml = `
events:
  generate_lead:
    parameters:
      ga_source: { type: string }
    consent: { status: notNeeded }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('a plain "currency" parameter passes (reserved only for dimension/metric creation)', () => {
  const yaml = `
events:
  purchase:
    parameters:
      currency: { type: string }
    consent: { status: notNeeded }
`;
  const config = validate(yaml);
  assert.equal(config.events.purchase.parameters.currency.type, 'string');
});

test('a "currency" parameter marked dimension: true still fails (reserved for custom dimensions)', () => {
  const yaml = `
events:
  purchase:
    parameters:
      currency: { type: string, dimension: true }
    consent: { status: notNeeded }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('type: items is accepted for an ecommerce item array parameter', () => {
  const yaml = `
events:
  purchase:
    parameters:
      items: { type: items }
    consent: { status: notNeeded }
`;
  const config = validate(yaml);
  assert.equal(config.events.purchase.parameters.items.type, 'items');
});

test('a type: items parameter cannot be marked dimension: true', () => {
  const yaml = `
events:
  purchase:
    parameters:
      items: { type: items, dimension: true }
    consent: { status: notNeeded }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('an event with more than 25 parameters fails GA4 naming lint', () => {
  const params = Array.from({ length: 26 }, (_, i) => `  param_${i}: { type: string }`).join('\n');
  const yaml = `
events:
  generate_lead:
    parameters:
${params}
    consent: { status: notNeeded }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('an ordinary snake_case event with a handful of parameters passes GA4 naming lint', () => {
  const yaml = `
events:
  generate_lead:
    parameters:
      form: { type: string }
    consent: { status: notNeeded }
`;
  assert.doesNotThrow(() => validate(yaml));
});

test('protected must be a boolean', () => {
  const yaml = `
gtm:
  tags:
    checkout_pixel: { type: customHtml, html: "<script></script>", protected: "yes" }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('ga4.dataRetention accepts a valid retention duration', () => {
  const yaml = `
ga4:
  dataRetention: FOURTEEN_MONTHS
`;
  const config = validate(yaml);
  assert.equal(config.ga4.dataRetention, 'FOURTEEN_MONTHS');
});

test('ga4.dataRetention rejects a value outside the RetentionDuration enum', () => {
  const yaml = `
ga4:
  dataRetention: SIX_MONTHS
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('ga4.dataRetention rejects RETENTION_DURATION_UNSPECIFIED, which is not a settable value', () => {
  const yaml = `
ga4:
  dataRetention: RETENTION_DURATION_UNSPECIFIED
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('ga4.googleSignals accepts GOOGLE_SIGNALS_DISABLED', () => {
  const yaml = `
ga4:
  googleSignals: GOOGLE_SIGNALS_DISABLED
`;
  const config = validate(yaml);
  assert.equal(config.ga4.googleSignals, 'GOOGLE_SIGNALS_DISABLED');
});

test('ga4.googleSignals rejects the output-only consent-style values', () => {
  const yaml = `
ga4:
  googleSignals: GOOGLE_SIGNALS_CONSENT_CONSENTED
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('ga4.attributionSettings accepts its three known fields', () => {
  const yaml = `
ga4:
  attributionSettings:
    reportingAttributionModel: PAID_AND_ORGANIC_CHANNELS_DATA_DRIVEN
    acquisitionConversionEventLookbackWindow: ACQUISITION_CONVERSION_EVENT_LOOKBACK_WINDOW_30_DAYS
    otherConversionEventLookbackWindow: OTHER_CONVERSION_EVENT_LOOKBACK_WINDOW_90_DAYS
`;
  const config = validate(yaml);
  assert.deepEqual(config.ga4.attributionSettings, {
    reportingAttributionModel: 'PAID_AND_ORGANIC_CHANNELS_DATA_DRIVEN',
    acquisitionConversionEventLookbackWindow: 'ACQUISITION_CONVERSION_EVENT_LOOKBACK_WINDOW_30_DAYS',
    otherConversionEventLookbackWindow: 'OTHER_CONVERSION_EVENT_LOOKBACK_WINDOW_90_DAYS',
  });
});

test('ga4.attributionSettings rejects an unknown field', () => {
  const yaml = `
ga4:
  attributionSettings:
    adsWebConversionDataExportScope: NOT_SELECTED_YET
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('ga4.enhancedMeasurement requires ga4.streamWebsiteUrl to be set', () => {
  const yaml = `
ga4:
  enhancedMeasurement:
    scrollsEnabled: false
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('ga4.enhancedMeasurement with streamWebsiteUrl set passes validation', () => {
  const yaml = `
ga4:
  streamWebsiteUrl: "https://example.com"
  enhancedMeasurement:
    scrollsEnabled: false
    outboundClicksEnabled: true
`;
  const config = validate(yaml);
  assert.deepEqual(config.ga4.enhancedMeasurement, { scrollsEnabled: false, outboundClicksEnabled: true });
});

test('ga4.enhancedMeasurement rejects an unknown field', () => {
  const yaml = `
ga4:
  streamWebsiteUrl: "https://example.com"
  enhancedMeasurement:
    pageChangesEnabled: true
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('ga4.audiences accepts a single leaf filter clause', () => {
  const yaml = `
ga4:
  audiences:
    pricing_viewers:
      description: Visitors who viewed the pricing page
      membershipDurationDays: 30
      filterClauses:
        - clauseType: INCLUDE
          scope: AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS
          filter:
            event:
              eventName: view_pricing
`;
  const config = validate(yaml);
  assert.equal(config.ga4.audiences.pricing_viewers.membershipDurationDays, 30);
  // GA4 requires the top-level filter expression to be an andGroup of orGroups (confirmed live
  // 2026-08-29) — validation normalizes a bare leaf filter into that shape automatically.
  assert.deepEqual(config.ga4.audiences.pricing_viewers.filterClauses[0].filter, {
    and: [{ or: [{ event: { eventName: 'view_pricing' } }] }],
  });
});

test('ga4.audiences accepts a nested and/or/not filter with a numeric leaf', () => {
  const yaml = `
ga4:
  audiences:
    engaged_desktop:
      description: Engaged desktop visitors
      membershipDurationDays: 90
      exclusionDurationMode: EXCLUDE_TEMPORARILY
      eventTrigger: { eventName: join_audience, logCondition: AUDIENCE_JOINED }
      filterClauses:
        - clauseType: INCLUDE
          scope: AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS
          filter:
            and:
              - or:
                  - dimensionOrMetric: { fieldName: sessionCount, numeric: { operation: GREATER_THAN, value: 2 } }
              - or:
                  - not:
                      dimensionOrMetric: { fieldName: deviceCategory, string: { matchType: EXACT, value: desktop } }
`;
  assert.doesNotThrow(() => validate(yaml));
});

test('ga4.audiences requires a non-empty filterClauses array', () => {
  const yaml = `
ga4:
  audiences:
    empty_audience:
      description: No filters
      membershipDurationDays: 30
      filterClauses: []
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('ga4.audiences rejects a filter expression with zero branches set', () => {
  const yaml = `
ga4:
  audiences:
    broken:
      description: broken
      membershipDurationDays: 30
      filterClauses:
        - clauseType: INCLUDE
          scope: AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS
          filter: {}
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('ga4.audiences rejects a filter expression with more than one branch set', () => {
  const yaml = `
ga4:
  audiences:
    broken:
      description: broken
      membershipDurationDays: 30
      filterClauses:
        - clauseType: INCLUDE
          scope: AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS
          filter:
            event: { eventName: x }
            dimensionOrMetric: { fieldName: y, string: { matchType: EXACT, value: z } }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('ga4.audiences rejects a dimensionOrMetric filter with zero or more than one value type set', () => {
  const yaml = `
ga4:
  audiences:
    broken:
      description: broken
      membershipDurationDays: 30
      filterClauses:
        - clauseType: INCLUDE
          scope: AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS
          filter:
            dimensionOrMetric: { fieldName: deviceCategory }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('ga4.audiences rejects membershipDurationDays that is not a number', () => {
  const yaml = `
ga4:
  audiences:
    broken:
      description: broken
      membershipDurationDays: "30"
      filterClauses:
        - clauseType: INCLUDE
          scope: AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS
          filter: { event: { eventName: x } }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('ga4.eventCreateRules requires ga4.streamWebsiteUrl to be set', () => {
  const yaml = `
ga4:
  eventCreateRules:
    custom_purchase:
      eventConditions:
        - { field: event_name, comparisonType: EQUALS, value: purchase }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('ga4.eventCreateRules accepts a rule when streamWebsiteUrl is set', () => {
  const yaml = `
ga4:
  streamWebsiteUrl: https://example.com
  eventCreateRules:
    custom_purchase:
      eventConditions:
        - { field: event_name, comparisonType: EQUALS, value: purchase }
      sourceCopyParameters: true
      parameterMutations:
        - { parameter: currency, parameterValue: USD }
`;
  const config = validate(yaml);
  assert.equal(config.ga4.eventCreateRules.custom_purchase.sourceCopyParameters, true);
  assert.deepEqual(config.ga4.eventCreateRules.custom_purchase.eventConditions, [
    { field: 'event_name', comparisonType: 'EQUALS', value: 'purchase' },
  ]);
});

test('ga4.eventCreateRules rejects more than 10 eventConditions', () => {
  const conditions = Array.from({ length: 11 }, (_, i) => `        - { field: f${i}, comparisonType: EQUALS, value: v }`).join('\n');
  const yaml = `
ga4:
  streamWebsiteUrl: https://example.com
  eventCreateRules:
    broken:
      eventConditions:
${conditions}
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('ga4.eventCreateRules rejects an unknown comparisonType', () => {
  const yaml = `
ga4:
  streamWebsiteUrl: https://example.com
  eventCreateRules:
    broken:
      eventConditions:
        - { field: event_name, comparisonType: NOT_A_TYPE, value: purchase }
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('ga4.eventCreateRules rejects more than 20 parameterMutations', () => {
  const mutations = Array.from({ length: 21 }, (_, i) => `        - { parameter: p${i}, parameterValue: v }`).join('\n');
  const yaml = `
ga4:
  streamWebsiteUrl: https://example.com
  eventCreateRules:
    broken:
      eventConditions:
        - { field: event_name, comparisonType: EQUALS, value: purchase }
      parameterMutations:
${mutations}
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('ga4.eventEditRules accepts a rule and requires a non-empty parameterMutations array', () => {
  const yaml = `
ga4:
  streamWebsiteUrl: https://example.com
  eventEditRules:
    rewrite_currency:
      eventConditions:
        - { field: event_name, comparisonType: EQUALS, value: purchase, negated: false }
      parameterMutations:
        - { parameter: currency, parameterValue: USD }
`;
  const config = validate(yaml);
  assert.deepEqual(config.ga4.eventEditRules.rewrite_currency.parameterMutations, [{ parameter: 'currency', parameterValue: 'USD' }]);

  const emptyMutations = `
ga4:
  streamWebsiteUrl: https://example.com
  eventEditRules:
    broken:
      eventConditions:
        - { field: event_name, comparisonType: EQUALS, value: purchase }
      parameterMutations: []
`;
  assert.throws(() => validate(emptyMutations), ConfigError);
});

test('ga4.calculatedMetrics accepts a metric and rejects an unknown metricUnit', () => {
  const yaml = `
ga4:
  calculatedMetrics:
    revenue_per_session:
      displayName: Revenue per session
      metricUnit: CURRENCY
      formula: "(eventCount / 2.0)"
      description: Custom calculated metric
`;
  const config = validate(yaml);
  assert.equal(config.ga4.calculatedMetrics.revenue_per_session.metricUnit, 'CURRENCY');
  assert.equal(config.ga4.calculatedMetrics.revenue_per_session.formula, '(eventCount / 2.0)');

  const broken = `
ga4:
  calculatedMetrics:
    broken:
      displayName: Broken
      metricUnit: NOT_A_UNIT
      formula: "(eventCount / 2.0)"
`;
  assert.throws(() => validate(broken), ConfigError);
});

test('ga4.channelGroups accepts a bare single-condition filter and canonicalizes it to andGroup-of-orGroup', () => {
  const yaml = `
ga4:
  channelGroups:
    paid_social:
      description: Paid social traffic
      groupingRule:
        - displayName: Paid Social
          expression:
            filter: { fieldName: eachScopeSource, string: { matchType: EXACT, value: facebook } }
`;
  const config = validate(yaml);
  assert.deepEqual(config.ga4.channelGroups.paid_social.groupingRule[0].expression, {
    and: [{ or: [{ filter: { fieldName: 'eachScopeSource', string: { matchType: 'EXACT', value: 'facebook' } } }] }],
  });
});

test('ga4.channelGroups rejects more than 50 grouping rules', () => {
  const rules = Array.from(
    { length: 51 },
    (_, i) => `        - displayName: Rule ${i}\n          expression: { filter: { fieldName: eachScopeSource, string: { matchType: EXACT, value: v } } }`,
  ).join('\n');
  const yaml = `
ga4:
  channelGroups:
    broken:
      groupingRule:
${rules}
`;
  assert.throws(() => validate(yaml), ConfigError);
});

test('ga4.channelGroups rejects a filter expression with none or more than one of and/or/not/filter set', () => {
  const empty = `
ga4:
  channelGroups:
    broken:
      groupingRule:
        - displayName: Rule
          expression: {}
`;
  assert.throws(() => validate(empty), ConfigError);

  const both = `
ga4:
  channelGroups:
    broken:
      groupingRule:
        - displayName: Rule
          expression:
            filter: { fieldName: eachScopeSource, string: { matchType: EXACT, value: v } }
            not: { filter: { fieldName: eachScopeMedium, string: { matchType: EXACT, value: v } } }
`;
  assert.throws(() => validate(both), ConfigError);
});

test('a GTM type the provider layer cannot build fails validation offline', () => {
  const yaml = `
gtm:
  variables:
    form: { type: dataLayerVariabl, variableName: form }
`;
  assert.throws(() => validate(yaml), (error: unknown) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /Unsupported variable type/);
    assert.match(error.message, /dataLayerVariable/); // the "did you mean" suggestion
    return true;
  });
});

test('an unsupported trigger and tag type fail the same way', () => {
  assert.throws(() => validate(`
gtm:
  triggers:
    t: { type: scrollDept }
`), ConfigError);
  assert.throws(() => validate(`
gtm:
  tags:
    t: { type: conversionLinker, consent: { status: notNeeded } }
`), ConfigError);
});

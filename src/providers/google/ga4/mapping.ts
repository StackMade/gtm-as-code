import type { Ga4Kind, Ga4Object } from './client.js';
import type {
  AudienceDef,
  AudienceDimensionOrMetricFilterDef,
  AudienceEventFilterDef,
  AudienceFilterClauseDef,
  AudienceFilterExpressionDef,
  EventCreateRuleDef,
  EventEditRuleDef,
  MatchingConditionDef,
  ParameterMutationDef,
} from '../../../config/schema.js';

export function toGa4Payload(kind: Ga4Kind, resourceId: string, desiredState: Record<string, unknown>): Ga4Object {
  if (kind === 'dimension') {
    return {
      parameterName: String(desiredState.parameter),
      displayName: resourceId,
      scope: String(desiredState.scope).toUpperCase(),
    };
  }

  if (kind === 'metric') {
    return {
      parameterName: String(desiredState.parameter),
      displayName: resourceId,
      measurementUnit: String(desiredState.measurementUnit ?? 'standard').toUpperCase(),
    };
  }

  if (kind === 'audience') {
    return toAudiencePayload(resourceId, desiredState as unknown as AudienceDef);
  }

  if (kind === 'eventCreateRule') {
    return toEventCreateRulePayload(resourceId, desiredState as unknown as EventCreateRuleDef);
  }

  if (kind === 'eventEditRule') {
    return toEventEditRulePayload(resourceId, desiredState as unknown as EventEditRuleDef);
  }

  return {
    eventName: resourceId,
    countingMethod: String(desiredState.countingMethod ?? 'ONCE_PER_EVENT'),
  };
}

export function fromGa4Payload(kind: Ga4Kind, object: Ga4Object): Record<string, unknown> {
  if (kind === 'dimension') {
    return { scope: String(object.scope).toLowerCase(), parameter: object.parameterName };
  }

  if (kind === 'metric') {
    return { scope: String(object.scope).toLowerCase(), parameter: object.parameterName, measurementUnit: String(object.measurementUnit).toLowerCase() };
  }

  if (kind === 'audience') {
    return fromAudiencePayload(object) as unknown as Record<string, unknown>;
  }

  if (kind === 'eventCreateRule') {
    return fromEventCreateRulePayload(object) as unknown as Record<string, unknown>;
  }

  if (kind === 'eventEditRule') {
    return fromEventEditRulePayload(object) as unknown as Record<string, unknown>;
  }

  return {};
}

function toEventCreateRulePayload(resourceId: string, def: EventCreateRuleDef): Ga4Object {
  return {
    destinationEvent: resourceId,
    eventConditions: def.eventConditions.map(toMatchingCondition),
    ...(def.sourceCopyParameters !== undefined ? { sourceCopyParameters: def.sourceCopyParameters } : {}),
    ...(def.parameterMutations ? { parameterMutations: def.parameterMutations.map(toParameterMutation) } : {}),
  };
}

/** `processingOrder` is output-only (GA4 rejects it in any `updateMask`, confirmed live 2026-08-29) — never sent. */
function toEventEditRulePayload(resourceId: string, def: EventEditRuleDef): Ga4Object {
  return {
    displayName: resourceId,
    eventConditions: def.eventConditions.map(toMatchingCondition),
    parameterMutations: def.parameterMutations.map(toParameterMutation),
  };
}

function toMatchingCondition(def: MatchingConditionDef): Record<string, unknown> {
  return {
    field: def.field,
    comparisonType: def.comparisonType,
    value: def.value,
    ...(def.negated !== undefined ? { negated: def.negated } : {}),
  };
}

function toParameterMutation(def: ParameterMutationDef): Record<string, unknown> {
  return { parameter: def.parameter, parameterValue: def.parameterValue };
}

/**
 * `name` and `destinationEvent` aren't stored here (both derive from `resourceId`, like `keyEvent`'s
 * `eventName`), same as `audience` drops `name`/`displayName`.
 */
function fromEventCreateRulePayload(object: Ga4Object): EventCreateRuleDef {
  return {
    eventConditions: ((object.eventConditions as unknown[]) ?? []).map(fromMatchingCondition),
    ...(object.sourceCopyParameters !== undefined ? { sourceCopyParameters: Boolean(object.sourceCopyParameters) } : {}),
    ...(object.parameterMutations ? { parameterMutations: (object.parameterMutations as unknown[]).map(fromParameterMutation) } : {}),
  };
}

/** `name`/`displayName`/`processingOrder` all dropped — `processingOrder` is output-only, keeping it
 *  here would create permanent phantom drift since `toEventEditRulePayload` never sends it back. */
function fromEventEditRulePayload(object: Ga4Object): EventEditRuleDef {
  return {
    eventConditions: ((object.eventConditions as unknown[]) ?? []).map(fromMatchingCondition),
    parameterMutations: ((object.parameterMutations as unknown[]) ?? []).map(fromParameterMutation),
  };
}

function fromMatchingCondition(raw: unknown): MatchingConditionDef {
  const condition = raw as Record<string, unknown>;
  return {
    field: String(condition.field),
    comparisonType: String(condition.comparisonType),
    value: String(condition.value),
    ...(condition.negated !== undefined ? { negated: Boolean(condition.negated) } : {}),
  };
}

function fromParameterMutation(raw: unknown): ParameterMutationDef {
  const mutation = raw as Record<string, unknown>;
  return { parameter: String(mutation.parameter), parameterValue: String(mutation.parameterValue) };
}

function toAudiencePayload(resourceId: string, def: AudienceDef): Ga4Object {
  return {
    displayName: resourceId,
    description: def.description,
    membershipDurationDays: def.membershipDurationDays,
    ...(def.eventTrigger ? { eventTrigger: def.eventTrigger } : {}),
    ...(def.exclusionDurationMode ? { exclusionDurationMode: def.exclusionDurationMode } : {}),
    filterClauses: def.filterClauses.map(toAudienceFilterClause),
  };
}

function toAudienceFilterClause(clause: AudienceFilterClauseDef): Record<string, unknown> {
  return {
    clauseType: clause.clauseType,
    simpleFilter: {
      scope: clause.scope,
      filterExpression: toAudienceFilterExpression(clause.filter),
    },
  };
}

/** GA4 itself further restricts nesting (an `andGroup`'s children must each be an `orGroup`) — this
 *  tool doesn't re-validate that; a mismatch surfaces as GA4's own `INVALID_ARGUMENT` on apply. */
function toAudienceFilterExpression(expr: AudienceFilterExpressionDef): Record<string, unknown> {
  if (expr.and) return { andGroup: { filterExpressions: expr.and.map(toAudienceFilterExpression) } };
  if (expr.or) return { orGroup: { filterExpressions: expr.or.map(toAudienceFilterExpression) } };
  if (expr.not) return { notExpression: toAudienceFilterExpression(expr.not) };
  if (expr.dimensionOrMetric) return { dimensionOrMetricFilter: toAudienceDimensionOrMetricFilter(expr.dimensionOrMetric) };
  if (expr.event) return { eventFilter: toAudienceEventFilter(expr.event) };
  throw new Error('Audience filter expression has none of and/or/not/dimensionOrMetric/event set.');
}

function toAudienceDimensionOrMetricFilter(def: AudienceDimensionOrMetricFilterDef): Record<string, unknown> {
  const result: Record<string, unknown> = {
    fieldName: def.fieldName,
    ...(def.atAnyPointInTime !== undefined ? { atAnyPointInTime: def.atAnyPointInTime } : {}),
    ...(def.inAnyNDayPeriod !== undefined ? { inAnyNDayPeriod: def.inAnyNDayPeriod } : {}),
  };
  if (def.string) result.stringFilter = def.string;
  if (def.inList) result.inListFilter = def.inList;
  if (def.numeric) result.numericFilter = { operation: def.numeric.operation, value: toAudienceNumericValue(def.numeric.value) };
  if (def.between) {
    result.betweenFilter = { fromValue: toAudienceNumericValue(def.between.from), toValue: toAudienceNumericValue(def.between.to) };
  }
  return result;
}

/** GA4's NumericValue is a oneof of `int64Value` (a string, protobuf's int64-over-JSON convention) and `doubleValue`. */
function toAudienceNumericValue(value: number): Record<string, unknown> {
  return Number.isInteger(value) ? { int64Value: String(value) } : { doubleValue: value };
}

function toAudienceEventFilter(def: AudienceEventFilterDef): Record<string, unknown> {
  return {
    eventName: def.eventName,
    ...(def.parameterFilter ? { eventParameterFilterExpression: toAudienceFilterExpression(def.parameterFilter) } : {}),
  };
}

function fromAudiencePayload(object: Ga4Object): AudienceDef {
  const eventTrigger = object.eventTrigger as AudienceDef['eventTrigger'];
  const exclusionDurationMode = object.exclusionDurationMode as string | undefined;
  return {
    description: String(object.description ?? ''),
    membershipDurationDays: Number(object.membershipDurationDays),
    ...(eventTrigger ? { eventTrigger } : {}),
    ...(exclusionDurationMode ? { exclusionDurationMode } : {}),
    filterClauses: ((object.filterClauses as unknown[]) ?? []).map(fromAudienceFilterClause),
  };
}

function fromAudienceFilterClause(raw: unknown): AudienceFilterClauseDef {
  const clause = raw as Record<string, unknown>;
  const simple = clause.simpleFilter as Record<string, unknown>;
  return {
    clauseType: clause.clauseType as AudienceFilterClauseDef['clauseType'],
    scope: String(simple.scope),
    filter: fromAudienceFilterExpression(simple.filterExpression),
  };
}

function fromAudienceFilterExpression(raw: unknown): AudienceFilterExpressionDef {
  const expr = raw as Record<string, unknown>;
  if (expr.andGroup) {
    const group = expr.andGroup as Record<string, unknown>;
    return { and: (group.filterExpressions as unknown[]).map(fromAudienceFilterExpression) };
  }
  if (expr.orGroup) {
    const group = expr.orGroup as Record<string, unknown>;
    return { or: (group.filterExpressions as unknown[]).map(fromAudienceFilterExpression) };
  }
  if (expr.notExpression) {
    return { not: fromAudienceFilterExpression(expr.notExpression) };
  }
  if (expr.dimensionOrMetricFilter) {
    return { dimensionOrMetric: fromAudienceDimensionOrMetricFilter(expr.dimensionOrMetricFilter) };
  }
  if (expr.eventFilter) {
    return { event: fromAudienceEventFilter(expr.eventFilter) };
  }
  throw new Error('GA4 returned an audience filter expression this tool cannot parse (unknown branch, possibly a sequenceFilter).');
}

function fromAudienceDimensionOrMetricFilter(raw: unknown): AudienceDimensionOrMetricFilterDef {
  const filter = raw as Record<string, unknown>;
  const result: AudienceDimensionOrMetricFilterDef = {
    fieldName: String(filter.fieldName),
    ...(filter.atAnyPointInTime !== undefined ? { atAnyPointInTime: Boolean(filter.atAnyPointInTime) } : {}),
    ...(filter.inAnyNDayPeriod !== undefined ? { inAnyNDayPeriod: Number(filter.inAnyNDayPeriod) } : {}),
  };
  if (filter.stringFilter) {
    const s = filter.stringFilter as Record<string, unknown>;
    result.string = {
      matchType: String(s.matchType),
      value: String(s.value),
      ...(s.caseSensitive !== undefined ? { caseSensitive: Boolean(s.caseSensitive) } : {}),
    };
  }
  if (filter.inListFilter) {
    const l = filter.inListFilter as Record<string, unknown>;
    result.inList = {
      values: (l.values as string[]) ?? [],
      ...(l.caseSensitive !== undefined ? { caseSensitive: Boolean(l.caseSensitive) } : {}),
    };
  }
  if (filter.numericFilter) {
    const n = filter.numericFilter as Record<string, unknown>;
    result.numeric = { operation: String(n.operation), value: fromAudienceNumericValue(n.value) };
  }
  if (filter.betweenFilter) {
    const b = filter.betweenFilter as Record<string, unknown>;
    result.between = { from: fromAudienceNumericValue(b.fromValue), to: fromAudienceNumericValue(b.toValue) };
  }
  return result;
}

function fromAudienceNumericValue(raw: unknown): number {
  const value = (raw ?? {}) as Record<string, unknown>;
  if (value.int64Value !== undefined) return Number(value.int64Value);
  return Number(value.doubleValue);
}

function fromAudienceEventFilter(raw: unknown): AudienceEventFilterDef {
  const filter = raw as Record<string, unknown>;
  return {
    eventName: String(filter.eventName),
    ...(filter.eventParameterFilterExpression ? { parameterFilter: fromAudienceFilterExpression(filter.eventParameterFilterExpression) } : {}),
  };
}

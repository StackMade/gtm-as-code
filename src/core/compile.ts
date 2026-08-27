import type { AnalyticsConfig } from '../config/schema.js';
import { ConfigError } from '../config/errors.js';
import type { Resource } from './resource.js';

/**
 * Expands high-level `events.*` declarations into the GTM/GA4 resources they
 * imply. An explicit `gtm.*`/`ga4.*` primitive in the same section wins over
 * the derived one — that is the escape hatch. A collision across *different*
 * sections has no such reading and is rejected.
 */
export function compileEvents(config: AnalyticsConfig, file: string): AnalyticsConfig {
  const usedIds = new Map<string, string>();
  const record = (id: string, where: string): void => {
    usedIds.set(id, where);
  };
  const assertAvailable = (id: string, where: string): void => {
    const existing = usedIds.get(id);
    if (existing !== undefined && existing !== where) {
      throw new ConfigError(file, undefined, where, [
        { label: 'Event-derived resource id collides with explicit config', value: id },
        { label: 'Also defined at', value: existing },
      ]);
    }
  };

  for (const [id, where] of sectionEntries(config)) record(id, where);

  const variables = { ...config.gtm.variables };
  const triggers = { ...config.gtm.triggers };
  const tags = { ...config.gtm.tags };
  const dimensions = { ...config.ga4.dimensions };
  const keyEvents = { ...config.ga4.keyEvents };

  for (const [eventId, event] of Object.entries(config.events)) {
    const eventWhere = `events.${eventId}`;
    const tagParameters: Record<string, string> = {};

    for (const [paramName, param] of Object.entries(event.parameters)) {
      const paramWhere = `${eventWhere}.parameters.${paramName}`;
      tagParameters[paramName] = `{{${paramName}}}`;

      if (!(paramName in variables)) {
        assertAvailable(paramName, paramWhere);
        record(paramName, paramWhere);
        variables[paramName] = { type: 'dataLayerVariable', variableName: paramName };
      }

      if (param.dimension && !(paramName in dimensions)) {
        assertAvailable(paramName, paramWhere);
        record(paramName, paramWhere);
        dimensions[paramName] = { scope: 'event', parameter: paramName };
      }
    }

    if (!(eventId in triggers)) {
      assertAvailable(eventId, eventWhere);
      record(eventId, eventWhere);
      triggers[eventId] = { type: 'customEvent', eventName: eventId };
    }

    if (!(eventId in tags)) {
      assertAvailable(eventId, eventWhere);
      record(eventId, eventWhere);
      tags[eventId] = {
        type: 'ga4Event',
        eventName: eventId,
        trigger: [eventId],
        parameters: tagParameters,
        ...(config.google.ga4.measurementId ? { measurementId: config.google.ga4.measurementId } : {}),
      };
    }

    if (event.keyEvent && !(eventId in keyEvents)) {
      assertAvailable(eventId, eventWhere);
      record(eventId, eventWhere);
      keyEvents[eventId] = {};
    }
  }

  return {
    ...config,
    gtm: { variables, triggers, tags },
    ga4: { ...config.ga4, dimensions, keyEvents },
  };
}

function* sectionEntries(config: AnalyticsConfig): Generator<[string, string]> {
  for (const id of Object.keys(config.gtm.variables)) yield [id, `gtm.variables.${id}`];
  for (const id of Object.keys(config.gtm.triggers)) yield [id, `gtm.triggers.${id}`];
  for (const id of Object.keys(config.gtm.tags)) yield [id, `gtm.tags.${id}`];
  for (const id of Object.keys(config.ga4.dimensions)) yield [id, `ga4.dimensions.${id}`];
  for (const id of Object.keys(config.ga4.keyEvents)) yield [id, `ga4.keyEvents.${id}`];
}

/** Flattens a (compiled) config into the generic Resource model. */
export function toResources(config: AnalyticsConfig): Resource[] {
  const resources: Resource[] = [];
  const push = (id: string, type: string, desiredState: unknown): void => {
    resources.push({ id, type, provider: 'google', desiredState });
  };

  for (const [id, def] of Object.entries(config.gtm.variables)) push(id, 'gtm.variable', def);
  for (const [id, def] of Object.entries(config.gtm.triggers)) push(id, 'gtm.trigger', def);
  for (const [id, def] of Object.entries(config.gtm.tags)) push(id, 'gtm.tag', def);
  for (const [id, def] of Object.entries(config.ga4.dimensions)) push(id, 'ga4.dimension', def);
  for (const [id, def] of Object.entries(config.ga4.metrics)) push(id, 'ga4.metric', def);
  for (const [id, def] of Object.entries(config.ga4.keyEvents)) push(id, 'ga4.keyEvent', def);

  return resources;
}

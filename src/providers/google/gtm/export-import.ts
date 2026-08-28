import type { GtmObject } from './client.js';
import { fromGtmPayload } from './mapping.js';

/** The three GTM object collections this codebase models, extracted from a container export. */
export interface ContainerExport {
  variable: GtmObject[];
  trigger: GtmObject[];
  tag: GtmObject[];
}

/**
 * Validates and extracts the collections this codebase understands from a GTM UI
 * container export (Admin → Export Container). `folder` and `builtInVariable` are
 * part of the format but not modeled here (0.4-milestone work) — ignored, not errored on.
 */
export function parseContainerExport(json: unknown): ContainerExport {
  if (typeof json !== 'object' || json === null) {
    throw new Error('not a GTM container export: expected a JSON object');
  }
  const root = json as Record<string, unknown>;
  if (root.exportFormatVersion === undefined) {
    throw new Error('not a GTM container export: missing exportFormatVersion');
  }
  if (typeof root.containerVersion !== 'object' || root.containerVersion === null) {
    throw new Error('not a GTM container export: missing containerVersion');
  }
  const containerVersion = root.containerVersion as Record<string, unknown>;

  const collection = (field: string): GtmObject[] => {
    const value = containerVersion[field];
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error(`not a GTM container export: containerVersion.${field} is not an array`);
    return value as GtmObject[];
  };

  return { variable: collection('variable'), trigger: collection('trigger'), tag: collection('tag') };
}

/** Lowercases and replaces runs of non `[a-z0-9_]` with `_`; suffixes `_2`, `_3`, ... on collision. */
function slugify(name: string, used: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'unnamed';
  let slug = base;
  let n = 2;
  while (used.has(slug)) {
    slug = `${base}_${n}`;
    n += 1;
  }
  used.add(slug);
  return slug;
}

/**
 * Turns a parsed container export into the `{ variables, triggers, tags, skipped }` shape
 * used by `AnalyticsConfig['gtm']`, reverse-mapping each raw GTM object via `fromGtmPayload`.
 * Triggers are processed first so tags can resolve `firingTriggerId` to `trigger: []`.
 *
 * A real container export routinely contains object types this tool doesn't model yet
 * (0.4-milestone GTM coverage) — `fromGtmPayload` throws for those, so they're counted
 * in `skipped` rather than aborting the whole import.
 */
export function resourcesFromExport(container: ContainerExport): Record<string, unknown> {
  let skipped = 0;

  const usedTriggerSlugs = new Set<string>();
  const triggerGtmIdToLogicalId: Record<string, string> = {};
  const triggers: Record<string, unknown> = {};
  for (const object of container.trigger) {
    try {
      const slug = slugify(String(object.name ?? ''), usedTriggerSlugs);
      triggers[slug] = fromGtmPayload('trigger', object);
      const triggerId = object.triggerId;
      if (typeof triggerId === 'string') triggerGtmIdToLogicalId[triggerId] = slug;
    } catch {
      skipped++;
    }
  }

  const usedVariableSlugs = new Set<string>();
  const variables: Record<string, unknown> = {};
  for (const object of container.variable) {
    try {
      variables[slugify(String(object.name ?? ''), usedVariableSlugs)] = fromGtmPayload('variable', object);
    } catch {
      skipped++;
    }
  }

  const usedTagSlugs = new Set<string>();
  const tags: Record<string, unknown> = {};
  for (const object of container.tag) {
    try {
      tags[slugify(String(object.name ?? ''), usedTagSlugs)] = fromGtmPayload('tag', object, { triggerGtmIdToLogicalId });
    } catch {
      skipped++;
    }
  }

  return { variables, triggers, tags, skipped };
}

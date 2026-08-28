import { Document, LineCounter, parseDocument, isMap, isScalar } from 'yaml';
import { ConfigError } from './errors.js';

export interface ParsedConfig {
  file: string;
  doc: Document;
  lineCounter: LineCounter;
  data: unknown;
  /**
   * Set only on a config merged from `extends:`. Maps a dotted path prefix for a mergeable map
   * entry (e.g. "events.generate_lead") to the ParsedConfig it was actually defined in, so errors
   * on included content point at the right file and line instead of the root config's.
   */
  origins?: Map<string, ParsedConfig>;
}

/** Top-level map sections an `extends:` target may contribute entries to. */
export const MERGEABLE_MAP_PATHS: string[][] = [
  ['events'],
  ['gtm', 'variables'],
  ['gtm', 'triggers'],
  ['gtm', 'tags'],
  ['gtm', 'folders'],
  ['ga4', 'dimensions'],
  ['ga4', 'metrics'],
  ['ga4', 'keyEvents'],
];

export function parseYaml(file: string, source: string): ParsedConfig {
  const lineCounter = new LineCounter();
  const doc = parseDocument(source, { lineCounter, uniqueKeys: true });
  if (doc.errors.length > 0) {
    const error = doc.errors[0];
    const line = error.linePos?.[0]?.line;
    throw new ConfigError(file, line, '', [{ label: 'YAML parse error', value: error.message }]);
  }
  return { file, doc, lineCounter, data: doc.toJS() ?? {} };
}

/** The dotted origin key for a path under a mergeable section, e.g. ["events","generate_lead","parameters"] -> "events.generate_lead". */
export function mergeOriginKey(path: string[]): string | undefined {
  for (const prefix of MERGEABLE_MAP_PATHS) {
    if (path.length > prefix.length && prefix.every((segment, i) => path[i] === segment)) {
      return [...prefix, path[prefix.length]].join('.');
    }
  }
  return undefined;
}

/** Resolves which ParsedConfig a path's error should be reported against: the origin file for merged-in content, or `parsed` itself. */
function resolveOrigin(parsed: ParsedConfig, path: string[]): ParsedConfig {
  if (!parsed.origins) return parsed;
  const key = mergeOriginKey(path);
  if (key === undefined) return parsed;
  return parsed.origins.get(key) ?? parsed;
}

/** Finds the source line for a dotted config path, walking the YAML AST rather than the parsed JS value. */
export function locateLine(parsed: ParsedConfig, path: string[]): number | undefined {
  const origin = resolveOrigin(parsed, path);
  let node: unknown = origin.doc.contents;
  let key: unknown;
  for (const segment of path) {
    if (!isMap(node)) return undefined;
    const pair = node.items.find((item) => isScalar(item.key) && String(item.key.value) === segment);
    if (!pair) return undefined;
    key = pair.key;
    node = pair.value;
  }
  const range = isScalar(key) ? key.range : undefined;
  if (!range) return undefined;
  return origin.lineCounter.linePos(range[0]).line;
}

/** The file a path's error should be attributed to: the origin file for merged-in content, or `parsed.file`. */
export function locateFile(parsed: ParsedConfig, path: string[]): string {
  return resolveOrigin(parsed, path).file;
}

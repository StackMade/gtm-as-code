import { Document, LineCounter, parseDocument, isMap, isScalar } from 'yaml';
import { ConfigError } from './errors.js';

export interface ParsedConfig {
  file: string;
  doc: Document;
  lineCounter: LineCounter;
  data: unknown;
}

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

/** Finds the source line for a dotted config path, walking the YAML AST rather than the parsed JS value. */
export function locateLine(parsed: ParsedConfig, path: string[]): number | undefined {
  let node: unknown = parsed.doc.contents;
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
  return parsed.lineCounter.linePos(range[0]).line;
}

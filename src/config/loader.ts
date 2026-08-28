import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseYaml, MERGEABLE_MAP_PATHS, type ParsedConfig } from './parser.js';
import { ConfigError } from './errors.js';

const DEFAULT_CANDIDATES = ['analytics.yaml', 'analytics/analytics.yaml'];

export function resolveConfigPath(configFlag?: string, cwd: string = process.cwd()): string {
  if (configFlag) {
    const explicit = resolve(cwd, configFlag);
    if (!existsSync(explicit)) {
      throw new Error(`Config file not found: ${configFlag}`);
    }
    return explicit;
  }
  for (const candidate of DEFAULT_CANDIDATES) {
    const full = resolve(cwd, candidate);
    if (existsSync(full)) return full;
  }
  throw new Error(
    `No analytics config found. Expected one of: ${DEFAULT_CANDIDATES.join(', ')} (or pass --config <path>).`,
  );
}

export function loadConfig(configFlag?: string, cwd: string = process.cwd()): ParsedConfig {
  const path = resolveConfigPath(configFlag, cwd);
  const source = readFileSync(path, 'utf8');
  return resolveExtends(parseYaml(path, source), new Set([path]));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getIn(root: unknown, path: string[]): unknown {
  let node = root;
  for (const segment of path) {
    if (!isPlainObject(node)) return undefined;
    node = node[segment];
  }
  return node;
}

function setIn(root: Record<string, unknown>, path: string[], key: string, value: unknown): void {
  let node = root;
  for (const segment of path) {
    if (!isPlainObject(node[segment])) node[segment] = {};
    node = node[segment] as Record<string, unknown>;
  }
  node[key] = value;
}

const NOT_ALLOWED_BODY = [
  { label: 'Not allowed in an extends target', value: 'only events, gtm.{variables,triggers,tags,folders}, and ga4.{dimensions,metrics,keyEvents}' },
];

/** Sections an `extends:` target may not touch: identity, credentials, and anything else root-only. */
function checkOnlyMergeableSections(include: ParsedConfig): void {
  const data = include.data;
  if (!isPlainObject(data)) return;

  const allowedTop = new Set(MERGEABLE_MAP_PATHS.map((p) => p[0]));
  for (const key of Object.keys(data)) {
    if (!allowedTop.has(key)) throw new ConfigError(include.file, undefined, key, NOT_ALLOWED_BODY);
  }

  for (const top of allowedTop) {
    const allowedSub = new Set(MERGEABLE_MAP_PATHS.filter((p) => p[0] === top && p.length > 1).map((p) => p[1]));
    if (allowedSub.size === 0) continue; // `events` has no sub-keys to restrict; every event name is allowed
    const section = getIn(data, [top]);
    if (!isPlainObject(section)) continue;
    for (const subKey of Object.keys(section)) {
      if (!allowedSub.has(subKey)) {
        throw new ConfigError(include.file, undefined, `${top}.${subKey}`, NOT_ALLOWED_BODY);
      }
    }
  }
}

function mergeInclude(target: Record<string, unknown>, origins: Map<string, ParsedConfig>, include: ParsedConfig): void {
  checkOnlyMergeableSections(include);

  for (const prefix of MERGEABLE_MAP_PATHS) {
    const sourceMap = getIn(include.data, prefix);
    if (!isPlainObject(sourceMap)) continue;

    for (const [key, value] of Object.entries(sourceMap)) {
      const originKey = [...prefix, key].join('.');
      const existingMap = getIn(target, prefix);
      if (isPlainObject(existingMap) && key in existingMap) {
        const priorFile = origins.get(originKey)?.file ?? 'the root config';
        throw new ConfigError(include.file, undefined, originKey, [
          { label: 'Defined more than once via extends', value: `already defined in ${priorFile}` },
        ]);
      }
      setIn(target, prefix, key, value);
      origins.set(originKey, include.origins?.get(originKey) ?? include);
    }
  }
}

function resolveExtends(parsed: ParsedConfig, visited: Set<string>): ParsedConfig {
  const data = parsed.data;
  if (!isPlainObject(data) || data.extends === undefined) return parsed;

  const raw = data.extends;
  const paths = Array.isArray(raw) ? raw : [raw];
  const dir = dirname(parsed.file);

  const merged: Record<string, unknown> = { ...data };
  delete merged.extends;
  const origins = new Map<string, ParsedConfig>();

  for (const rel of paths) {
    if (typeof rel !== 'string') {
      throw new ConfigError(parsed.file, undefined, 'extends', [
        { label: 'Expected', value: 'a string, or an array of strings' },
      ]);
    }
    const includePath = resolve(dir, rel);
    if (visited.has(includePath)) {
      throw new ConfigError(parsed.file, undefined, 'extends', [{ label: 'Circular extends', value: includePath }]);
    }
    if (!existsSync(includePath)) {
      throw new ConfigError(parsed.file, undefined, 'extends', [{ label: 'Include not found', value: includePath }]);
    }

    const includeSource = readFileSync(includePath, 'utf8');
    const includeParsed = resolveExtends(parseYaml(includePath, includeSource), new Set([...visited, includePath]));
    mergeInclude(merged, origins, includeParsed);
  }

  // Root entries were already in `merged` before any include ran, so `mergeInclude`'s collision
  // check rejects an include that redefines them: root wins by construction, not by a merge order
  // trick. Anything not recorded in `origins` above is root's own, and `locateLine`/`locateFile`
  // already fall back to `parsed` (the root) for a path with no origins entry.

  return { ...parsed, data: merged, origins };
}

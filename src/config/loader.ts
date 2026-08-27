import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseYaml, type ParsedConfig } from './parser.js';

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
  return parseYaml(path, source);
}

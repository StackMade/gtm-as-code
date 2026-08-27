import { relative } from 'node:path';
import { loadConfig } from '../../config/loader.js';
import { interpolateConfig } from '../../config/interpolation.js';
import { validateConfig, summarizeConfig } from '../../config/schema.js';
import { ConfigError } from '../../config/errors.js';
import { compileEvents } from '../../core/compile.js';
import type { GlobalOptions } from '../options.js';

export function validate(opts: GlobalOptions): void {
  try {
    const parsed = loadConfig(opts.config);
    const interpolated = { ...parsed, data: interpolateConfig(parsed) };
    const config = validateConfig(interpolated);
    compileEvents(config, parsed.file);
    const summary = summarizeConfig(config);
    const displayPath = relative(process.cwd(), parsed.file);

    console.log(`✓ ${displayPath} parsed`);
    console.log(`✓ ${summary.events} events`);
    console.log(`✓ ${summary.dimensions} custom dimensions`);
    console.log(`✓ ${summary.keyEvents} key events`);
    console.log('✓ configuration valid');
  } catch (error) {
    printFailure(error);
    process.exitCode = 1;
  }
}

function printFailure(error: unknown): void {
  if (error instanceof ConfigError) {
    console.error(error.message);
    console.error('');
    console.error('Validation failed.');
    return;
  }
  console.error(error instanceof Error ? error.message : String(error));
}

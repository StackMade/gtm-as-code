import { writeFileSync } from 'node:fs';
import { loadConfig } from '../../config/loader.js';
import { interpolateConfig } from '../../config/interpolation.js';
import { validateConfig } from '../../config/schema.js';
import { compileEvents } from '../../core/compile.js';
import { generateEventTypes } from '../../core/generate.js';
import { ConfigError } from '../../config/errors.js';
import type { GlobalOptions } from '../options.js';

export function generate(opts: GlobalOptions & { out?: string }): void {
  try {
    const parsed = loadConfig(opts.config);
    const interpolated = { ...parsed, data: interpolateConfig(parsed) };
    const config = validateConfig(interpolated);
    const compiled = compileEvents(config, parsed.file);
    const source = generateEventTypes(compiled);

    if (opts.out) {
      writeFileSync(opts.out, source);
      console.log(`✓ wrote ${opts.out}`);
    } else {
      console.log(source);
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

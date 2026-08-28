import { writeFileSync } from 'node:fs';
import { loadConfig } from '../../config/loader.js';
import { interpolateConfig } from '../../config/interpolation.js';
import { validateConfig } from '../../config/schema.js';
import { compileEvents } from '../../core/compile.js';
import { generateDataDictionary } from '../../core/docs.js';
import { ConfigError } from '../../config/errors.js';
import type { GlobalOptions } from '../options.js';

export function docs(opts: GlobalOptions & { out?: string }): void {
  try {
    const parsed = loadConfig(opts.config);
    const interpolated = { ...parsed, data: interpolateConfig(parsed) };
    const config = validateConfig(interpolated);
    const compiled = compileEvents(config, parsed.file);
    const markdown = generateDataDictionary(compiled);

    if (opts.out) {
      writeFileSync(opts.out, markdown);
      console.log(`✓ wrote ${opts.out}`);
    } else {
      console.log(markdown);
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

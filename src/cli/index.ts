#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { init } from './commands/init.js';
import { validate } from './commands/validate.js';
import { plan } from './commands/plan.js';
import { diff } from './commands/diff.js';
import { drift } from './commands/drift.js';
import { apply } from './commands/apply.js';
import { publish } from './commands/publish.js';
import { rollback } from './commands/rollback.js';
import { pull } from './commands/pull.js';
import { adopt } from './commands/adopt.js';
import type { GlobalOptions } from './options.js';

// package.json is the only place the version is written down; `npm version` bumps it there.
const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

const program = new Command();

program
  .name('gtm-code')
  .description('GTM & GA4 as code — plan and apply Google Tag Manager / Analytics 4 config from YAML')
  .version(version)
  .option('-v, --verbose', 'verbose output', false)
  .option('-q, --quiet', 'suppress non-error output', false)
  .option('-f, --format <type>', 'output format: text, json, markdown', 'text')
  .option('-c, --config <path>', 'path to the analytics config file');

function globalOptions(cmd: Command): GlobalOptions {
  return cmd.optsWithGlobals<GlobalOptions>();
}

program
  .command('init')
  .description('create the initial project structure')
  .action(async function (this: Command) {
    await init(globalOptions(this));
  });

program
  .command('validate')
  .description('validate the analytics config against the schema')
  .action(function (this: Command) {
    validate(globalOptions(this));
  });

program
  .command('plan')
  .description('show what would change without applying it')
  .action(async function (this: Command) {
    await plan(globalOptions(this));
  });

program
  .command('diff')
  .description('compare two config files without touching the network')
  .argument('<fileA>', 'baseline config file')
  .argument('<fileB>', 'desired config file')
  .action(async function (this: Command, fileA: string, fileB: string) {
    await diff(fileA, fileB, globalOptions(this));
  });

program
  .command('drift')
  .description('check whether live state has diverged from config (exit 1 if it has)')
  .action(async function (this: Command) {
    await drift(globalOptions(this));
  });

program
  .command('apply')
  .description('apply the config to GTM/GA4')
  .option('--auto-approve', 'skip the confirmation prompt', false)
  .option('--allow-destroy', 'allow apply to include deletes', false)
  .action(async function (this: Command) {
    await apply(globalOptions(this));
  });

program
  .command('publish')
  .description('create a GTM container version from the current workspace and publish it')
  .action(async function (this: Command) {
    await publish(globalOptions(this));
  });

program
  .command('rollback')
  .description('republish the container version that was live before the current one')
  .option('--auto-approve', 'skip the confirmation prompt', false)
  .action(async function (this: Command) {
    await rollback(globalOptions(this));
  });

program
  .command('pull')
  .description('reverse-generate YAML from a live GTM container and GA4 property')
  .option('--resource <kindAndId>', 'pull one resource into the existing config, e.g. tag:generate_lead_tag')
  .option('--out <path>', 'where to write the generated config (default: the resolved config path)')
  .option('--from-export <path>', 'read a GTM UI container export (Admin > Export Container) instead of calling the API')
  .action(async function (this: Command) {
    const opts = this.opts<{ resource?: string; out?: string; fromExport?: string }>();
    await pull({ ...globalOptions(this), resource: opts.resource, out: opts.out, fromExport: opts.fromExport });
  });

program
  .command('adopt')
  .description('stamp ownership on a resource pull already brought into the config, so plan/apply treat it as managed')
  .argument('<kindAndId>', 'e.g. tag:generate_lead_tag')
  .action(async function (this: Command, resourceArg: string) {
    await adopt(resourceArg, globalOptions(this));
  });

await program.parseAsync();

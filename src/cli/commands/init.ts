import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import type { GlobalOptions } from '../options.js';

export async function init(_opts: GlobalOptions): Promise<void> {
  const dir = join(process.cwd(), 'analytics');
  const configPath = join(dir, 'analytics.yaml');
  const readmePath = join(dir, 'README.md');
  const envExamplePath = join(dir, '.env.analytics.example');

  if (existsSync(configPath)) {
    const [answer] = await promptSequence([`${configPath} already exists. Overwrite? [y/N] `]);
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('Aborted. Existing configuration left untouched.');
      return;
    }
  }

  const [accountId, containerId, propertyId] = await promptSequence([
    'GTM account ID: ',
    'GTM container ID: ',
    'GA4 property ID: ',
  ]);

  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, renderConfig(), 'utf8');
  writeFileSync(readmePath, renderReadme(), 'utf8');
  writeFileSync(envExamplePath, renderEnvExample(accountId, containerId, propertyId), 'utf8');

  console.log('Created:');
  console.log(`  ${configPath}`);
  console.log(`  ${readmePath}`);
  console.log(`  ${envExamplePath}`);
}

/**
 * readline/promises' `question()` hangs after the first call on piped (non-TTY) stdin —
 * https://github.com/nodejs/node/issues/38609. Driving the interface as an async iterator
 * of 'line' events instead works for both interactive and piped input.
 */
async function promptSequence(questions: string[]): Promise<string[]> {
  const rl = createInterface({ input, output });
  const answers: string[] = [];
  let index = 0;
  output.write(questions[0]);
  for await (const line of rl) {
    answers.push(line);
    index++;
    if (index >= questions.length) break;
    output.write(questions[index]);
  }
  rl.close();
  while (answers.length < questions.length) answers.push('');
  return answers;
}

function renderConfig(): string {
  return `version: 1

project:
  name: change-me

google:
  gtm:
    accountId: "\${GTM_ACCOUNT_ID}"
    containerId: "\${GTM_CONTAINER_ID}"

  ga4:
    propertyId: "\${GA4_PROPERTY_ID}"

events: {}

gtm:
  variables: {}
  triggers: {}
  tags: {}

ga4:
  dimensions: {}
  metrics: {}
  keyEvents: {}
`;
}

function renderReadme(): string {
  return `# Analytics

GTM and GA4 configuration managed by [gtm-code](https://github.com/StackMade/gtm-as-code).

- Edit \`analytics.yaml\` to declare events, GTM resources, and GA4 resources.
- Set \`GTM_ACCOUNT_ID\`, \`GTM_CONTAINER_ID\`, and \`GA4_PROPERTY_ID\` in your environment
  (see \`.env.analytics.example\`). Never commit real values into \`analytics.yaml\`.
- Run \`gtm-code validate\` to check the config offline.
- Run \`gtm-code plan\` to preview changes, \`gtm-code apply\` to apply them.
`;
}

function renderEnvExample(accountId: string, containerId: string, propertyId: string): string {
  return `GTM_ACCOUNT_ID=${accountId || 'your-gtm-account-id'}
GTM_CONTAINER_ID=${containerId || 'your-gtm-container-id'}
GA4_PROPERTY_ID=${propertyId || 'your-ga4-property-id'}
`;
}

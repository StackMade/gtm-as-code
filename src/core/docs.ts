import type { AnalyticsConfig, EventDef } from '../config/schema.js';

export function generateDataDictionary(config: AnalyticsConfig): string {
  const eventNames = Object.keys(config.events).sort();
  const lines: string[] = [];

  lines.push(`# ${config.project.name} tracking plan`, '');
  lines.push(`${eventNames.length} events.`, '');

  for (const name of eventNames) {
    const event = config.events[name] as EventDef;
    lines.push(`## ${name}`, '');
    if (event.description) lines.push(event.description, '');

    const flags: string[] = [];
    if (event.keyEvent) flags.push('key event');
    if (event.consent) flags.push(`consent: ${event.consent.status}${event.consent.types ? ` (${event.consent.types.join(', ')})` : ''}`);
    if (flags.length) lines.push(flags.join(' · '), '');

    const paramNames = Object.keys(event.parameters);
    if (paramNames.length === 0) {
      lines.push('No parameters.', '');
      continue;
    }

    lines.push('| parameter | type | required | dimension |', '| --- | --- | --- | --- |');
    for (const paramName of paramNames) {
      const param = event.parameters[paramName];
      lines.push(`| ${paramName} | ${param.type} | ${param.optional ? 'no' : 'yes'} | ${param.dimension ? 'yes' : 'no'} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

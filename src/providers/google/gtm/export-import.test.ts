import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseContainerExport, resourcesFromExport } from './export-import.js';

function baseExport(containerVersion: Record<string, unknown>) {
  return { exportFormatVersion: 2, exportTime: '2026-01-01T00:00:00Z', containerVersion };
}

test('parses a normal export and resolves a tag firing trigger back to a logical id', () => {
  const container = parseContainerExport(
    baseExport({
      accountId: '1',
      containerId: '2',
      variable: [{ variableId: '1', name: 'Form', type: 'v', parameter: [{ type: 'template', key: 'name', value: 'form' }] }],
      trigger: [{ triggerId: '5', name: 'Generate Lead', type: 'customEvent', customEventFilter: [
        { type: 'equals', parameter: [{ type: 'template', key: 'arg0', value: '{{_event}}' }, { type: 'template', key: 'arg1', value: 'generate_lead' }] },
      ] }],
      tag: [{ tagId: '9', name: 'GA4 - Generate Lead', type: 'gaawe', firingTriggerId: ['5'], parameter: [
        { type: 'template', key: 'eventName', value: 'generate_lead' },
      ] }],
    }),
  );
  assert.equal(container.variable.length, 1);
  assert.equal(container.trigger.length, 1);
  assert.equal(container.tag.length, 1);

  const resources = resourcesFromExport(container);
  assert.deepEqual(resources.variables, { form: { type: 'dataLayerVariable', variableName: 'form' } });
  assert.deepEqual(resources.triggers, { generate_lead: { type: 'customEvent', eventName: 'generate_lead' } });
  assert.deepEqual(resources.tags, {
    ga4_generate_lead: {
      type: 'ga4Event',
      eventName: 'generate_lead',
      measurementId: undefined,
      parameters: {},
      trigger: ['generate_lead'],
      exceptTrigger: [],
    },
  });
});

test('a missing collection defaults to an empty array', () => {
  const container = parseContainerExport(baseExport({ accountId: '1', containerId: '2', variable: [], trigger: [] }));
  assert.deepEqual(container.tag, []);
  assert.deepEqual(resourcesFromExport(container).tags, {});
});

test('colliding names are slugified with numeric suffixes', () => {
  const container = parseContainerExport(
    baseExport({
      accountId: '1',
      containerId: '2',
      variable: [
        { variableId: '1', name: 'My Var!', type: 'v', parameter: [{ type: 'template', key: 'name', value: 'a' }] },
        { variableId: '2', name: 'My Var?', type: 'v', parameter: [{ type: 'template', key: 'name', value: 'b' }] },
      ],
    }),
  );
  const resources = resourcesFromExport(container);
  assert.deepEqual(Object.keys(resources.variables as Record<string, unknown>), ['my_var', 'my_var_2']);
});

test('an object type this tool has no reverse mapping for is skipped, not fatal', () => {
  const container = parseContainerExport(
    baseExport({
      accountId: '1',
      containerId: '2',
      variable: [
        { variableId: '1', name: 'Form', type: 'v', parameter: [{ type: 'template', key: 'name', value: 'form' }] },
        { variableId: '2', name: 'Some Built-in', type: 'k' },
      ],
    }),
  );
  const resources = resourcesFromExport(container);
  assert.deepEqual(resources.variables, { form: { type: 'dataLayerVariable', variableName: 'form' } });
  assert.equal(resources.skipped, 1);
});

test('rejects JSON that is not a container export', () => {
  assert.throws(() => parseContainerExport({}), /missing exportFormatVersion/);
  assert.throws(() => parseContainerExport({ exportFormatVersion: 2 }), /missing containerVersion/);
  assert.throws(() => parseContainerExport(null), /expected a JSON object/);
});

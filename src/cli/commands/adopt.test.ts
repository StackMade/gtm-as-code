import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findGa4Match, findGtmMatch } from './adopt.js';
import { Ga4Client } from '../../providers/google/ga4/client.js';
import type { GtmObject } from '../../providers/google/gtm/client.js';

const STREAM = 'properties/1/dataStreams/7';

function fakeGa4(): { ga4: Ga4Client; urls: string[] } {
  const urls: string[] = [];
  const auth = {
    request: async (options: { url: string }) => {
      urls.push(options.url);
      if (options.url.endsWith('/dataStreams')) {
        return { data: { dataStreams: [{ name: STREAM, type: 'WEB_DATA_STREAM', webStreamData: { defaultUri: 'https://example.com' } }] } };
      }
      if (options.url.endsWith('/eventCreateRules')) {
        return { data: { eventCreateRules: [{ name: `${STREAM}/eventCreateRules/9`, destinationEvent: 'lead' }] } };
      }
      return { data: { customDimensions: [{ name: 'properties/1/customDimensions/3', parameterName: 'form' }] } };
    },
  };
  return { ga4: new Ga4Client(auth as never, '1'), urls };
}

test('findGa4Match looks a stream-scoped kind up on the stream streamWebsiteUrl resolves to', async () => {
  const { ga4, urls } = fakeGa4();
  assert.equal(await findGa4Match(ga4, 'eventCreateRule', 'lead', 'https://example.com/'), `${STREAM}/eventCreateRules/9`);
  assert.ok(urls.some((url) => url.endsWith(`/${STREAM}/eventCreateRules`)));
});

test('findGa4Match names ga4.streamWebsiteUrl for a stream-scoped kind when it is unset, before any request', async () => {
  const { ga4, urls } = fakeGa4();
  await assert.rejects(findGa4Match(ga4, 'eventEditRule', 'x'), /ga4\.streamWebsiteUrl/);
  assert.deepEqual(urls, []);
});

test('findGa4Match needs no stream for a property-level kind', async () => {
  const { ga4, urls } = fakeGa4();
  assert.equal(await findGa4Match(ga4, 'dimension', 'form'), 'properties/1/customDimensions/3');
  assert.equal(urls.length, 1);
});

test('findGa4Match fails naming the id when nothing matches', async () => {
  const { ga4 } = fakeGa4();
  await assert.rejects(findGa4Match(ga4, 'eventCreateRule', 'nope', 'https://example.com'), /"nope"/);
});

const triggers: GtmObject[] = [
  { triggerId: '5', name: 'Generate Lead', type: 'customEvent' },
  { triggerId: '6', name: 'Submit Form', type: 'customEvent' },
];

test('findGtmMatch finds the object whose slugified name equals the given id', () => {
  const match = findGtmMatch(triggers, 'trigger', 'submit_form');
  assert.deepEqual(match, { object: triggers[1], gtmId: '6' });
});

test('findGtmMatch returns null when no object slugifies to that id', () => {
  assert.equal(findGtmMatch(triggers, 'trigger', 'nonexistent'), null);
});

test('findGtmMatch returns null when the matched object has no id field for this kind', () => {
  const objects: GtmObject[] = [{ name: 'Odd One' }];
  assert.equal(findGtmMatch(objects, 'trigger', 'odd_one'), null);
});

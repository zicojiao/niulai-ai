import assert from 'node:assert/strict';
import { requestAgentStopOnPageExit } from '../src/callExitPolicy';

const beaconCalls: Array<{ url: string; data?: BodyInit | null }> = [];
let fetchCalls = 0;
const beaconResult = requestAgentStopOnPageExit('agent_beacon', 'stop_beacon', {
  sendBeacon(url, data) {
    beaconCalls.push({ url, data });
    return true;
  },
  fetch: async () => {
    fetchCalls += 1;
    return new Response(null, { status: 204 });
  },
});

assert.equal(beaconResult, 'beacon');
assert.equal(fetchCalls, 0);
assert.deepEqual(beaconCalls, [
  {
    url: '/api/stop-conversation',
    data: JSON.stringify({
      agent_id: 'agent_beacon',
      stop_token: 'stop_beacon',
    }),
  },
]);

let fallbackRequest:
  | { input: RequestInfo | URL; init?: RequestInit }
  | undefined;
const fallbackResult = requestAgentStopOnPageExit(
  'agent_fallback',
  'stop_fallback',
  {
    sendBeacon: () => false,
    fetch: async (input, init) => {
      fallbackRequest = { input, init };
      return new Response(null, { status: 204 });
    },
  },
);

assert.equal(fallbackResult, 'fetch');
assert.equal(fallbackRequest?.input, '/api/stop-conversation');
assert.deepEqual(fallbackRequest?.init, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agent_id: 'agent_fallback',
    stop_token: 'stop_fallback',
  }),
  keepalive: true,
});

console.log('Call exit policy checks passed.');

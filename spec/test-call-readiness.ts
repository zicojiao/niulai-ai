import assert from 'node:assert/strict';
import { isCallReady, type CallReadiness } from '../src/callReadiness';
import { settleOptionalOperation } from '../src/optionalOperation';

const ready: CallReadiness = {
  agentPresent: true,
  rtcConnected: true,
  hasMicrophoneTrack: true,
  microphoneLoading: false,
  publishLoading: false,
  microphonePublished: true,
};

assert.equal(isCallReady(ready), true);

for (const key of [
  'agentPresent',
  'rtcConnected',
  'hasMicrophoneTrack',
  'microphonePublished',
] as const) {
  assert.equal(isCallReady({ ...ready, [key]: false }), false, key);
}

for (const key of ['microphoneLoading', 'publishLoading'] as const) {
  assert.equal(isCallReady({ ...ready, [key]: true }), false, key);
}

async function testOptionalOperationFallback() {
  const available = await settleOptionalOperation(Promise.resolve('rtm'), 50);
  assert.deepEqual(available, { status: 'available', value: 'rtm' });

  const rejectedError = new Error('offline');
  const rejected = await settleOptionalOperation(
    Promise.reject(rejectedError),
    50,
  );
  assert.deepEqual(rejected, { status: 'rejected', error: rejectedError });

  let resolveLate!: (value: string) => void;
  let lateCleanupValue = '';
  const lateOperation = new Promise<string>((resolve) => {
    resolveLate = resolve;
  });
  const timedOut = await settleOptionalOperation(
    lateOperation,
    1,
    (value) => {
      lateCleanupValue = value;
    },
  );
  assert.deepEqual(timedOut, { status: 'timeout' });
  resolveLate('late-rtm');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(lateCleanupValue, 'late-rtm');
}

testOptionalOperationFallback()
  .then(() => console.log('Agora call readiness checks passed.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

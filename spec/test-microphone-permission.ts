import assert from 'node:assert/strict';
import {
  MICROPHONE_CONSTRAINTS,
  ensureMicrophonePermission,
  type MicrophonePermissionSource,
} from '../src/microphonePermission';

async function main() {
  let receivedConstraints: MediaStreamConstraints | undefined;
  let stoppedTracks = 0;
  const permissionSource = {
    async getUserMedia(constraints: MediaStreamConstraints) {
      receivedConstraints = constraints;
      return {
        getTracks: () => [
          { stop: () => stoppedTracks += 1 },
          { stop: () => stoppedTracks += 1 },
        ],
      } as unknown as MediaStream;
    },
  } satisfies MicrophonePermissionSource;

  await ensureMicrophonePermission(permissionSource);
  assert.deepEqual(receivedConstraints, MICROPHONE_CONSTRAINTS);
  assert.equal(stoppedTracks, 2);

  await assert.rejects(
    ensureMicrophonePermission(undefined),
    /cannot access a microphone/,
  );

  await assert.rejects(
    ensureMicrophonePermission({
      async getUserMedia() {
        throw new DOMException('Denied', 'NotAllowedError');
      },
    }),
    /Microphone access is required/,
  );

  await assert.rejects(
    ensureMicrophonePermission({
      async getUserMedia() {
        throw new DOMException('Missing', 'NotFoundError');
      },
    }),
    /No microphone was found/,
  );

  console.log('Microphone permission checks passed.');
}

void main();

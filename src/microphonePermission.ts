export type MicrophonePermissionSource = Pick<
  MediaDevices,
  'getUserMedia'
>;

export const MICROPHONE_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
  },
  video: false,
};

export async function ensureMicrophonePermission(
  mediaDevices: MicrophonePermissionSource | undefined,
) {
  if (!mediaDevices?.getUserMedia) {
    throw new Error(
      'This browser cannot access a microphone. Open the site in Safari or Chrome and try again.',
    );
  }

  let stream: MediaStream;
  try {
    stream = await mediaDevices.getUserMedia(MICROPHONE_CONSTRAINTS);
  } catch (error) {
    const name =
      error && typeof error === 'object' && 'name' in error
        ? String(error.name)
        : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new Error(
        'Microphone access is required. Allow it in your browser settings, then hang up and try again.',
      );
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      throw new Error(
        'No microphone was found. Connect a microphone, then hang up and try again.',
      );
    }
    throw new Error(
      'The microphone could not be opened. Hang up and try again.',
    );
  }

  for (const track of stream.getTracks()) {
    track.stop();
  }
}

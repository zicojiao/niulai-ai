import { FishAudioTTS } from 'agora-agents';

export const FISH_AUDIO_REFERENCE_ID =
  'd733401d62fd43a3b889792e9fc3084a';
export const FISH_AUDIO_BACKEND = 's2.1-pro';

export function createFishAudioTts(
  key = process.env.FISH_AUDIO_API_KEY,
  referenceId = FISH_AUDIO_REFERENCE_ID,
) {
  if (!key) {
    throw new Error(
      'Missing required environment variable: FISH_AUDIO_API_KEY',
    );
  }
  return new FishAudioTTS({
    key,
    referenceId: referenceId || FISH_AUDIO_REFERENCE_ID,
    backend: FISH_AUDIO_BACKEND,
  });
}

export type CowCallPhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'ending'
  | 'error';

export const COW_CALL_STATE_EVENT = 'niulai:call-state';
export const COW_AUDIO_LEVEL_EVENT = 'niulai:audio-level';
export const COW_TOGGLE_CALL_EVENT = 'niulai:toggle-call';
export const COW_SCENE_READY_EVENT = 'niulai:scene-ready';

export type CowCallStateDetail = {
  phase: CowCallPhase;
  secondsRemaining: number;
  error?: string;
};

export type CowAudioLevelDetail = {
  /** 0..1 loudness of the agent's voice. */
  agent: number;
  /** 0..1 loudness of the caller's microphone. */
  caller: number;
};

export function dispatchCowCallState(detail: CowCallStateDetail) {
  window.dispatchEvent(
    new CustomEvent<CowCallStateDetail>(COW_CALL_STATE_EVENT, { detail }),
  );
}

export function dispatchCowAudioLevel(detail: CowAudioLevelDetail) {
  window.dispatchEvent(
    new CustomEvent<CowAudioLevelDetail>(COW_AUDIO_LEVEL_EVENT, { detail }),
  );
}

/** The bull itself is the call button: clicking the sculpt raises this. */
export function requestCowCallToggle() {
  window.dispatchEvent(new Event(COW_TOGGLE_CALL_EVENT));
}

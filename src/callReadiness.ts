export interface CallReadiness {
  agentPresent: boolean;
  rtcConnected: boolean;
  hasMicrophoneTrack: boolean;
  microphoneLoading: boolean;
  publishLoading: boolean;
  microphonePublished: boolean;
}

export function isCallReady(state: CallReadiness) {
  return (
    state.agentPresent &&
    state.rtcConnected &&
    state.hasMicrophoneTrack &&
    !state.microphoneLoading &&
    !state.publishLoading &&
    state.microphonePublished
  );
}

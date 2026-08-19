'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RemoteUser,
  useClientEvent,
  useJoin,
  useLocalMicrophoneTrack,
  usePublish,
  useRemoteUsers,
  useRTCClient,
} from 'agora-rtc-react';
import {
  AgoraVoiceAI,
  AgoraVoiceAIEvents,
  TranscriptHelperMode,
} from 'agora-agent-client-toolkit';
import { DEFAULT_AGENT_UID } from '@/lib/agora';
import { isCallReady } from '@/src/callReadiness';
import { dispatchCowAudioLevel } from '@/src/cow/cowEvents';
import { smoothLevel } from '@/src/cow/audioLevel';
import type { AgoraRuntimeProps } from '@/types/conversation';

/** 60fps is wasted on a VU meter; the rig smooths between samples anyway. */
const LEVEL_INTERVAL_MS = 50;

export default function CowCallRuntime({
  agoraData,
  rtmClient,
  onConnected,
  onAgentLeft,
  onMicrophoneState,
  onRuntimeError,
  onTokenWillExpire,
}: AgoraRuntimeProps) {
  const client = useRTCClient();
  const remoteUsers = useRemoteUsers();
  const [isReady, setIsReady] = useState(false);
  const callWasReady = useRef(false);
  const agentUid = process.env.NEXT_PUBLIC_AGENT_UID ?? String(DEFAULT_AGENT_UID);
  const agentPresent = remoteUsers.some((user) => String(user.uid) === agentUid);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) setIsReady(true);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setIsReady(false);
    };
  }, []);

  const { isConnected: rtcConnected, error: joinError } = useJoin(
    {
      appid: process.env.NEXT_PUBLIC_AGORA_APP_ID!,
      channel: agoraData.channel,
      token: agoraData.token,
      uid: Number.parseInt(agoraData.uid, 10),
    },
    isReady,
  );

  const {
    localMicrophoneTrack,
    isLoading: microphoneLoading,
    error: microphoneError,
  } = useLocalMicrophoneTrack(isReady);
  const { isLoading: publishLoading, error: publishError } = usePublish(
    [localMicrophoneTrack],
    Boolean(localMicrophoneTrack && rtcConnected),
  );

  const microphonePublished = Boolean(
    localMicrophoneTrack &&
      client.localTracks.some(
        (track) => track.getTrackId() === localMicrophoneTrack.getTrackId(),
      ),
  );
  const callReady = isCallReady({
    agentPresent,
    rtcConnected,
    hasMicrophoneTrack: Boolean(localMicrophoneTrack),
    microphoneLoading,
    publishLoading,
    microphonePublished,
  });

  useEffect(() => {
    if (microphonePublished && !publishLoading) {
      onMicrophoneState('ready');
    } else if (localMicrophoneTrack) {
      onMicrophoneState('publishing');
    } else {
      onMicrophoneState('requesting');
    }
  }, [localMicrophoneTrack, microphonePublished, onMicrophoneState, publishLoading]);

  useEffect(() => {
    const runtimeError = joinError ?? microphoneError ?? publishError;
    if (!runtimeError) return;
    onRuntimeError(runtimeError.message || '音频通道启动失败。');
  }, [joinError, microphoneError, onRuntimeError, publishError]);

  // The bull's mouth is driven straight off the agent's published audio: the
  // toolkit's transcript events land too late and too coarsely to lip-sync to.
  const agentTrack = remoteUsers.find(
    (user) => String(user.uid) === agentUid,
  )?.audioTrack;

  useEffect(() => {
    if (!callReady) return;
    let agent = 0;
    let caller = 0;
    const interval = window.setInterval(() => {
      agent = smoothLevel(agent, agentTrack?.getVolumeLevel() ?? 0);
      caller = smoothLevel(caller, localMicrophoneTrack?.getVolumeLevel() ?? 0);
      dispatchCowAudioLevel({ agent, caller });
    }, LEVEL_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      dispatchCowAudioLevel({ agent: 0, caller: 0 });
    };
  }, [agentTrack, callReady, localMicrophoneTrack]);

  useEffect(() => {
    if (!isReady || !rtcConnected) return;
    let cancelled = false;

    void (async () => {
      try {
        const voiceAi = await AgoraVoiceAI.init({
          rtcEngine: client,
          ...(rtmClient ? { rtmConfig: { rtmEngine: rtmClient } } : {}),
          renderMode: TranscriptHelperMode.TEXT,
          enableLog: false,
        });
        if (cancelled) {
          if (AgoraVoiceAI.getInstance() === voiceAi) {
            voiceAi.unsubscribe();
            voiceAi.destroy();
          }
          return;
        }
        voiceAi.on(AgoraVoiceAIEvents.AGENT_ERROR, (_, error) => {
          onRuntimeError(error.message || '牛来那边报了个错。');
        });
        voiceAi.on(AgoraVoiceAIEvents.MESSAGE_ERROR, (_, error) => {
          console.warn(
            '语音消息通道降级；音频通话仍在继续。',
            error,
          );
        });
        voiceAi.subscribeMessage(agoraData.channel);
      } catch (error) {
        if (!cancelled) {
          console.warn(
            '语音状态功能不可用；音频通话仍在继续。',
            error,
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        const voiceAi = AgoraVoiceAI.getInstance();
        voiceAi?.unsubscribe();
        voiceAi?.destroy();
      } catch {
        // The toolkit is already gone.
      }
    };
  }, [agoraData.channel, client, isReady, onRuntimeError, rtcConnected, rtmClient]);

  useEffect(() => {
    if (callReady && !callWasReady.current) {
      callWasReady.current = true;
      onConnected();
    }
  }, [callReady, onConnected]);

  useClientEvent(client, 'user-left', (user) => {
    if (String(user.uid) === agentUid && callWasReady.current) {
      callWasReady.current = false;
      onAgentLeft();
    }
  });

  const renewTokens = useCallback(async () => {
    if (!client.uid) return;
    try {
      const token = await onTokenWillExpire();
      await Promise.all([
        client.renewToken(token),
        rtmClient?.renewToken(token) ?? Promise.resolve(),
      ]);
    } catch (error) {
      onRuntimeError(
        error instanceof Error ? error.message : '语音令牌续期失败。',
      );
    }
  }, [client, onRuntimeError, onTokenWillExpire, rtmClient]);

  useClientEvent(client, 'token-privilege-will-expire', renewTokens);

  useClientEvent(client, 'connection-state-change', (state) => {
    if (state === 'DISCONNECTED' && callWasReady.current) {
      onRuntimeError('实时连接断开了。');
    }
  });

  return (
    <div className="agora-remote-audio" aria-hidden="true">
      {remoteUsers.map((user) => (
        <RemoteUser key={user.uid} user={user} />
      ))}
    </div>
  );
}

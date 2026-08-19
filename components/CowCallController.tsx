'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RTMClient } from 'agora-rtm';
import {
  COW_TOGGLE_CALL_EVENT,
  dispatchCowAudioLevel,
  dispatchCowCallState,
  type CowCallPhase,
} from '@/src/cow/cowEvents';
import {
  COW_CALL_LIMIT_SECONDS,
  canEndCowCall,
  canStartCowCall,
  cowSecondsRemaining,
  formatCowCallTime,
} from '@/src/cowCallPolicy';
import { requestAgentStopOnPageExit } from '@/src/callExitPolicy';
import { ensureMicrophonePermission } from '@/src/microphonePermission';
import { settleOptionalOperation } from '@/src/optionalOperation';
import type {
  AgentResponse,
  AgoraTokenData,
  AgoraTokenIssue,
  ClientStartRequest,
  MicrophoneRuntimeState,
  StopConversationRequest,
} from '@/types/conversation';

const CowCallRuntime = dynamic(() => import('./CowCallRuntime'), { ssr: false });

const RTM_CONNECT_TIMEOUT_MS = 5_000;

const AgoraProvider = dynamic(
  async () => {
    const { AgoraRTCProvider, default: AgoraRTC } = await import('agora-rtc-react');
    return {
      default: function AgoraRuntimeProvider({
        children,
      }: {
        children: React.ReactNode;
      }) {
        const clientRef = useRef<ReturnType<typeof AgoraRTC.createClient> | null>(
          null,
        );
        if (!clientRef.current) {
          clientRef.current = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        }
        return (
          <AgoraRTCProvider client={clientRef.current}>{children}</AgoraRTCProvider>
        );
      },
    };
  },
  { ssr: false },
);

type ActiveSession = {
  agoraData: AgoraTokenData;
  rtmClient: RTMClient | null;
};

/** An agent that started before the session was assembled, or torn down. */
type PendingAgent = { agentId: string; stopToken: string };

type ConnectionStep = 'permission' | 'agent' | 'microphone';

async function parseError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || fallback;
  } catch {
    return fallback;
  }
}

const STEP_COPY: Record<ConnectionStep, string> = {
  permission: '请允许使用麦克风',
  agent: '正在叫醒牛来…',
  microphone: '正在准备麦克风…',
};

export default function CowCallController() {
  const [phase, setPhase] = useState<CowCallPhase>('idle');
  const [remaining, setRemaining] = useState(COW_CALL_LIMIT_SECONDS);
  const [errorMessage, setErrorMessage] = useState('');
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [connectionStep, setConnectionStep] = useState<ConnectionStep>('permission');
  const phaseRef = useRef<CowCallPhase>('idle');
  // Mirrors `remaining` so the callbacks handed to the runtime stay
  // referentially stable — a countdown tick must not tear the runtime down.
  const remainingRef = useRef(COW_CALL_LIMIT_SECONDS);
  const sessionRef = useRef<ActiveSession | null>(null);
  const lifecycleRef = useRef(0);
  const deadlineRef = useRef(0);
  const stopPromiseRef = useRef<Promise<void> | null>(null);
  const pendingAgentRef = useRef<PendingAgent | null>(null);

  const publishState = useCallback(
    (next: CowCallPhase, nextRemaining = remainingRef.current, error?: string) => {
      phaseRef.current = next;
      remainingRef.current = nextRemaining;
      setPhase(next);
      setRemaining(nextRemaining);
      setErrorMessage(error ?? '');
      dispatchCowCallState({
        phase: next,
        secondsRemaining: nextRemaining,
        error,
      });
    },
    [],
  );

  const stopAgent = useCallback(async (agent: PendingAgent) => {
    try {
      const response = await fetch('/api/stop-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agent.agentId,
          stop_token: agent.stopToken,
        } satisfies StopConversationRequest),
        keepalive: true,
      });
      if (!response.ok) {
        console.error(
          'Agora agent stop failed:',
          await parseError(response, 'Unknown stop error.'),
        );
      }
    } catch (error) {
      console.error('Agora agent stop request failed:', error);
    }
  }, []);

  const finishCall = useCallback(() => {
    if (stopPromiseRef.current) return stopPromiseRef.current;
    if (phaseRef.current === 'idle' && !sessionRef.current && !pendingAgentRef.current) {
      return Promise.resolve();
    }

    lifecycleRef.current += 1;
    publishState('ending', remainingRef.current);
    const activeSession = sessionRef.current;
    const pendingAgent = pendingAgentRef.current;
    sessionRef.current = null;
    pendingAgentRef.current = null;
    setSession(null);
    dispatchCowAudioLevel({ agent: 0, caller: 0 });

    const operation = Promise.allSettled([
      activeSession
        ? Promise.allSettled([
            stopAgent({
              agentId: activeSession.agoraData.agentId,
              stopToken: activeSession.agoraData.stopToken,
            }),
            activeSession.rtmClient?.logout() ?? Promise.resolve(),
          ])
        : Promise.resolve(),
      pendingAgent ? stopAgent(pendingAgent) : Promise.resolve(),
    ])
      .then(() => undefined)
      .finally(() => {
        deadlineRef.current = 0;
        publishState('idle', COW_CALL_LIMIT_SECONDS);
        stopPromiseRef.current = null;
      });
    stopPromiseRef.current = operation;
    return operation;
  }, [publishState, stopAgent]);

  const startCall = useCallback(async () => {
    // Read through a local: the guard is a narrowing predicate, and publishState
    // moves the ref on underneath it.
    const startingPhase: CowCallPhase = phaseRef.current;
    if (!canStartCowCall(startingPhase) || stopPromiseRef.current) return;

    const lifecycle = ++lifecycleRef.current;
    setConnectionStep('permission');
    publishState('connecting', COW_CALL_LIMIT_SECONDS);

    try {
      await ensureMicrophonePermission(navigator.mediaDevices);
      if (lifecycle !== lifecycleRef.current || phaseRef.current !== 'connecting') {
        return;
      }

      setConnectionStep('agent');
      const tokenResponse = await fetch('/api/generate-agora-token');
      if (!tokenResponse.ok) {
        throw new Error(await parseError(tokenResponse, '没能接通语音线路。'));
      }
      const tokenData = (await tokenResponse.json()) as AgoraTokenIssue;

      const agentPromise = fetch('/api/invite-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requester_id: tokenData.uid,
          channel_name: tokenData.channel,
          ticket: tokenData.ticket,
          persona: 'niulai',
        } satisfies ClientStartRequest),
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error(await parseError(response, '牛来没有醒过来。'));
        }
        const result = (await response.json()) as AgentResponse;
        const agent: PendingAgent = {
          agentId: result.agent_id,
          stopToken: result.stop_token,
        };
        pendingAgentRef.current = agent;
        return agent;
      });

      const rtmPromise = (async () => {
        const { default: AgoraRTM } = await import('agora-rtm');
        const rtmClient: RTMClient = new AgoraRTM.RTM(
          process.env.NEXT_PUBLIC_AGORA_APP_ID!,
          tokenData.uid,
        );
        try {
          await rtmClient.login({ token: tokenData.token });
          await rtmClient.subscribe(tokenData.channel);
          return rtmClient;
        } catch (error) {
          await rtmClient.logout().catch(() => undefined);
          throw error;
        }
      })();
      const optionalRtmPromise = settleOptionalOperation(
        rtmPromise,
        RTM_CONNECT_TIMEOUT_MS,
        (lateClient) => lateClient.logout(),
      );

      const [agentResult, rtmResult] = await Promise.allSettled([
        agentPromise,
        optionalRtmPromise,
      ]);
      const rtmSetup =
        rtmResult.status === 'fulfilled'
          ? rtmResult.value
          : { status: 'rejected' as const, error: rtmResult.reason };
      const connectedRtmClient =
        rtmSetup.status === 'available' ? rtmSetup.value : null;
      if (rtmSetup.status !== 'available') {
        console.warn(
          rtmSetup.status === 'timeout'
            ? '语音消息通道连接超时；继续使用音频通话。'
            : '语音消息通道连接失败；继续使用音频通话。',
          rtmSetup.status === 'rejected' ? rtmSetup.error : undefined,
        );
      }

      // Whatever half of the handshake succeeded has to be torn down again when
      // the caller hangs up mid-connect or the other half fails.
      const abandonPartialSetup = async () => {
        const startedAgent =
          agentResult.status === 'fulfilled' ? agentResult.value : null;
        if (startedAgent && pendingAgentRef.current?.agentId === startedAgent.agentId) {
          pendingAgentRef.current = null;
        }
        await Promise.allSettled([
          startedAgent ? stopAgent(startedAgent) : Promise.resolve(),
          connectedRtmClient?.logout() ?? Promise.resolve(),
        ]);
      };

      if (lifecycle !== lifecycleRef.current || phaseRef.current !== 'connecting') {
        await abandonPartialSetup();
        return;
      }
      if (agentResult.status === 'rejected') {
        await abandonPartialSetup();
        throw agentResult.reason;
      }

      const activeSession: ActiveSession = {
        agoraData: {
          ...tokenData,
          agentId: agentResult.value.agentId,
          stopToken: agentResult.value.stopToken,
        },
        rtmClient: connectedRtmClient,
      };
      pendingAgentRef.current = null;
      sessionRef.current = activeSession;
      setSession(activeSession);
    } catch (error) {
      if (lifecycle !== lifecycleRef.current) return;
      publishState(
        'error',
        COW_CALL_LIMIT_SECONDS,
        error instanceof Error ? error.message : '牛来这会儿叫不醒。',
      );
    }
  }, [publishState, stopAgent]);

  useEffect(() => {
    const toggle = () => {
      if (canEndCowCall(phaseRef.current)) {
        void finishCall();
        return;
      }
      void startCall();
    };
    window.addEventListener(COW_TOGGLE_CALL_EVENT, toggle);
    return () => window.removeEventListener(COW_TOGGLE_CALL_EVENT, toggle);
  }, [finishCall, startCall]);

  const handleConnected = useCallback(() => {
    if (phaseRef.current !== 'connecting') return;
    deadlineRef.current = Date.now() + COW_CALL_LIMIT_SECONDS * 1000;
    publishState('connected', COW_CALL_LIMIT_SECONDS);
  }, [publishState]);

  const handleMicrophoneState = useCallback((state: MicrophoneRuntimeState) => {
    if (phaseRef.current !== 'connecting') return;
    if (state === 'ready') return;
    setConnectionStep('microphone');
  }, []);

  const handleRuntimeError = useCallback(
    (message: string) => {
      if (phaseRef.current === 'ending' || phaseRef.current === 'idle') return;
      publishState('error', remainingRef.current, message);
      void finishCall();
    },
    [finishCall, publishState],
  );

  const handleAgentLeft = useCallback(() => {
    handleRuntimeError('牛来走开了。');
  }, [handleRuntimeError]);

  const renewToken = useCallback(async (): Promise<string> => {
    const activeSession = sessionRef.current;
    if (!activeSession) throw new Error('这通对话已经结束了。');
    // The ticket carries the channel and uid, so renewal cannot be pointed at
    // another line. One combined token serves both RTC and RTM, as at join.
    const response = await fetch(
      `/api/generate-agora-token?ticket=${encodeURIComponent(
        activeSession.agoraData.ticket,
      )}`,
    );
    if (!response.ok) {
      throw new Error(await parseError(response, '语音令牌续期失败。'));
    }
    return ((await response.json()) as AgoraTokenIssue).token;
  }, []);

  useEffect(() => {
    if (phase !== 'connected') return;
    const tick = () => {
      const next = cowSecondsRemaining(deadlineRef.current, Date.now());
      remainingRef.current = next;
      setRemaining(next);
      dispatchCowCallState({ phase: 'connected', secondsRemaining: next });
      if (next === 0) void finishCall();
    };
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [finishCall, phase]);

  useEffect(() => {
    const handlePageHide = () => {
      lifecycleRef.current += 1;
      const activeSession = sessionRef.current;
      const agent: PendingAgent | null = activeSession
        ? {
            agentId: activeSession.agoraData.agentId,
            stopToken: activeSession.agoraData.stopToken,
          }
        : pendingAgentRef.current;
      if (!agent) return;
      requestAgentStopOnPageExit(agent.agentId, agent.stopToken, {
        sendBeacon: navigator.sendBeacon.bind(navigator),
        fetch: window.fetch.bind(window),
      });
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, []);

  const busy = phase === 'connecting' || phase === 'ending';

  return (
    <>
      {session ? (
        <AgoraProvider>
          <CowCallRuntime
            agoraData={session.agoraData}
            rtmClient={session.rtmClient}
            onConnected={handleConnected}
            onAgentLeft={handleAgentLeft}
            onMicrophoneState={handleMicrophoneState}
            onRuntimeError={handleRuntimeError}
            onTokenWillExpire={renewToken}
          />
        </AgoraProvider>
      ) : null}

      <div className="cow-console">
        <button
          type="button"
          className={`cow-talk is-${phase}`}
          onClick={() => (canEndCowCall(phase) ? void finishCall() : void startCall())}
          disabled={busy}
        >
          <span className="cow-talk-label">
            {phase === 'connected'
              ? '结束对话'
              : phase === 'connecting'
                ? '接通中…'
                : phase === 'ending'
                  ? '正在挂断…'
                  : phase === 'error'
                    ? '再试一次'
                    : '跟牛来说话'}
          </span>
          {phase === 'connected' ? (
            <time className={remaining <= 60 ? 'is-warning' : ''}>
              {formatCowCallTime(remaining)}
            </time>
          ) : null}
        </button>

        <p className="cow-hint" aria-live="polite">
          {phase === 'connecting'
            ? STEP_COPY[connectionStep]
            : phase === 'connected'
              ? '直接说话就行，牛来在听。'
              : phase === 'error'
                ? errorMessage || '线路出了点问题。'
                : '点它开口说话，按住拖动可以转着看。'}
        </p>
      </div>
    </>
  );
}

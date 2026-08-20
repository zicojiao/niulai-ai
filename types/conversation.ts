import type { RTMClient } from 'agora-rtm';

export interface AgoraTokenIssue {
  token: string;
  uid: string;
  channel: string;
  /** Signed proof that this caller opened the channel. */
  ticket: string;
}

export interface AgoraTokenData extends AgoraTokenIssue {
  agentId: string;
  /** Signed proof that this caller started the agent. */
  stopToken: string;
}

export interface ClientStartRequest {
  requester_id: string;
  channel_name: string;
  ticket: string;
  /** Which character answers. Defaults to 牛来. */
  persona?: 'niulai' | 'niulai-en';
}

export interface StopConversationRequest {
  agent_id: string;
  stop_token: string;
}

export interface AgentResponse {
  agent_id: string;
  stop_token: string;
  create_ts: number;
  state: string;
}

export type MicrophoneRuntimeState =
  | 'requesting'
  | 'publishing'
  | 'ready';

export interface AgoraRuntimeProps {
  locale: import('@/types/cow').CowLocale;
  agoraData: AgoraTokenData;
  rtmClient: RTMClient | null;
  onConnected: () => void;
  onAgentLeft: () => void;
  onMicrophoneState: (state: MicrophoneRuntimeState) => void;
  onRuntimeError: (message: string) => void;
  /** Resolves to a fresh combined RTC + RTM token for the active session. */
  onTokenWillExpire: () => Promise<string>;
}

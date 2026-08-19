import { NextResponse } from 'next/server';
import { AgoraClient, Area } from 'agora-agents';
import { isStopTokenFor } from '@/lib/callTicket';
import type { StopConversationRequest } from '@/types/conversation';

function isAlreadyStopped(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    statusCode?: number;
    body?: { detail?: string; reason?: string };
    message?: string;
  };
  const detail = (
    candidate.body?.detail ??
    candidate.message ??
    ''
  ).toLowerCase();
  return (
    candidate.statusCode === 404 ||
    (
      candidate.body?.reason?.toLowerCase() === 'invalidrequest' &&
      detail.includes('already in the process of shutting down')
    )
  );
}

function isValidStopRequest(value: unknown): value is StopConversationRequest {
  if (!value || typeof value !== 'object') return false;
  const body = value as Partial<StopConversationRequest>;
  return (
    typeof body.agent_id === 'string' &&
    /^[A-Za-z0-9_-]{1,128}$/.test(body.agent_id) &&
    typeof body.stop_token === 'string'
  );
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!isValidStopRequest(body)) {
      return NextResponse.json(
        { error: 'A valid agent_id and stop_token are required.' },
        { status: 400 },
      );
    }

    // Only whoever started this agent holds its signature, so one caller can
    // never hang up another caller's line.
    if (!isStopTokenFor(body.agent_id, body.stop_token)) {
      return NextResponse.json(
        { error: 'The stop token does not match this agent.' },
        { status: 403 },
      );
    }

    const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
    const appCertificate = process.env.NEXT_AGORA_APP_CERTIFICATE;
    if (!appId || !appCertificate) {
      throw new Error('语音服务未配置。');
    }

    const client = new AgoraClient({
      area: Area.US,
      appId,
      appCertificate,
    });

    try {
      await client.stopAgent(body.agent_id);
    } catch (error) {
      if (isAlreadyStopped(error)) {
        return NextResponse.json({
          success: true,
          state: 'already-stopping',
        });
      }
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to stop voice agent:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to stop the voice agent.',
      },
      { status: 500 },
    );
  }
}

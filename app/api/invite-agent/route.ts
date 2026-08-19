import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { AgoraClient, Agent, Area, ExpiresIn, OpenAI } from 'agora-agents';
import { DEFAULT_AGENT_UID } from '@/lib/agora';
import { isCallTicketFor, issueStopToken } from '@/lib/callTicket';
import { PERSONAS, isPersonaId, pickGreeting } from '@/lib/personas';
import type { AgentResponse, ClientStartRequest } from '@/types/conversation';

const agentUid =
  process.env.NEXT_PUBLIC_AGENT_UID ?? String(DEFAULT_AGENT_UID);

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function isValidStartRequest(value: unknown): value is ClientStartRequest {
  if (!value || typeof value !== 'object') return false;
  const body = value as Partial<ClientStartRequest>;
  return (
    typeof body.requester_id === 'string' &&
    /^[1-9][0-9]{0,9}$/.test(body.requester_id) &&
    typeof body.channel_name === 'string' &&
    /^[A-Za-z0-9_-]{1,64}$/.test(body.channel_name) &&
    typeof body.ticket === 'string' &&
    (body.persona === undefined || isPersonaId(body.persona))
  );
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    if (!isValidStartRequest(body)) {
      return NextResponse.json(
        { error: 'A valid requester_id, channel_name, and ticket are required.' },
        { status: 400 },
      );
    }

    // The ticket proves this caller opened the channel it is asking us to
    // dial into, so an agent can never be started in someone else's channel.
    if (!isCallTicketFor(body.ticket, body.channel_name, body.requester_id)) {
      return NextResponse.json(
        { error: 'The call ticket is invalid or expired.' },
        { status: 403 },
      );
    }

    const personaId = body.persona ?? 'niulai';
    const persona = PERSONAS[personaId];
    const greeting = pickGreeting(personaId);
    const appId = requireEnv('NEXT_PUBLIC_AGORA_APP_ID');
    const appCertificate = requireEnv('NEXT_AGORA_APP_CERTIFICATE');
    const client = new AgoraClient({
      area: Area.US,
      appId,
      appCertificate,
    });

    const agent = new Agent({
      client,
      turnDetection: {
        // The SDK uses this top-level value for the REST ASR language. The
        // provider's `params.language` alone is not enough and otherwise
        // defaults to en-US, which prevents Chinese speech from transcribing.
        language: persona.language,
        config: {
          speech_threshold: 0.5,
          start_of_speech: {
            mode: 'vad',
            vad_config: {
              interrupt_duration_ms: 160,
              prefix_padding_ms: 300,
            },
          },
          end_of_speech: {
            mode: 'vad',
            vad_config: {
              silence_duration_ms: 480,
            },
          },
        },
      },
      advancedFeatures: { enable_rtm: true, enable_tools: true },
      parameters: {
        audio_scenario: 'chorus',
        data_channel: 'rtm',
        enable_error_message: true,
        enable_metrics: true,
      },
    })
      .withStt(persona.createStt())
      .withLlm(
        new OpenAI({
          model: 'gpt-4o-mini',
          systemMessages: [{ role: 'system', content: persona.prompt }],
          greetingMessage: greeting,
          failureMessage: '哎，等我一下。',
          maxHistory: 15,
          params: {
            max_tokens: 512,
            temperature: 0.7,
            top_p: 0.95,
          },
        }),
      )
      .withTts(persona.createTts());

    const session = agent.createSession({
      // Agent names must be unique per project; the SDK default is a bare
      // millisecond timestamp, which collides on simultaneous calls.
      name: `${persona.slug}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      channel: body.channel_name,
      agentUid,
      remoteUids: [body.requester_id],
      idleTimeout: 300,
      expiresIn: ExpiresIn.minutes(5),
      debug: false,
    });

    let requestAborted = request.signal.aborted;
    let abortStopPromise: Promise<void> | null = null;
    const stopAbortedSession = () => {
      if (
        abortStopPromise ||
        !session.id ||
        session.status !== 'running'
      ) {
        return;
      }
      abortStopPromise = session.stop().catch(async (error) => {
        console.error('Failed to stop an aborted Agora session:', error);
        await client.stopAgent(session.id!);
      });
    };
    const handleRequestAbort = () => {
      requestAborted = true;
      stopAbortedSession();
    };
    request.signal.addEventListener('abort', handleRequestAbort, {
      once: true,
    });

    let agentId: string;
    try {
      agentId = await session.start();
      if (requestAborted) {
        stopAbortedSession();
        await abortStopPromise;
        return NextResponse.json(
          { error: 'The caller left before the agent connected.' },
          { status: 499 },
        );
      }
    } finally {
      request.signal.removeEventListener('abort', handleRequestAbort);
    }

    return NextResponse.json({
      agent_id: agentId,
      stop_token: issueStopToken(agentId),
      create_ts: Math.floor(Date.now() / 1000),
      state: 'RUNNING',
    } satisfies AgentResponse);
  } catch (error) {
    console.error('Failed to start Agora agent:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to start the Agora agent.',
      },
      { status: 500 },
    );
  }
}

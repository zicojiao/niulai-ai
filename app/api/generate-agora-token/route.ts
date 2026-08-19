import { NextRequest, NextResponse } from 'next/server';
import AgoraToken from 'agora-token';
import { issueCallTicket, readCallTicket } from '@/lib/callTicket';

const { RtcRole, RtcTokenBuilder } = AgoraToken;

const TOKEN_EXPIRATION_SECONDS = 10 * 60;

function generateChannelName() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  return `niulai-ai-${timestamp}-${random}`;
}

export async function GET(request: NextRequest) {
  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
  const appCertificate = process.env.NEXT_AGORA_APP_CERTIFICATE;

  if (!appId || !appCertificate || !process.env.CALL_TICKET_SECRET) {
    return NextResponse.json(
      { error: '语音服务未配置。' },
      { status: 500 },
    );
  }

  // Renewals present the ticket issued with the original token; the channel
  // and uid come from the signed claims, never from caller-supplied query
  // parameters. A request without a ticket always opens a brand new line.
  const requestedTicket = new URL(request.url).searchParams.get('ticket');

  try {
    let channel: string;
    let uid: string;
    let ticket: string;

    if (requestedTicket) {
      const claims = readCallTicket(requestedTicket);
      if (!claims) {
        return NextResponse.json(
          { error: 'The call ticket is invalid or expired.' },
          { status: 403 },
        );
      }
      channel = claims.channel;
      uid = claims.uid;
      ticket = requestedTicket;
    } else {
      channel = generateChannelName();
      uid = String(Math.floor(Math.random() * 9_999_000) + 1000);
      ticket = issueCallTicket(channel, uid);
    }

    // buildTokenWithRtm takes lifetimes in seconds from now, not absolute
    // timestamps — passing a Unix timestamp mints a token valid for decades.
    const token = RtcTokenBuilder.buildTokenWithRtm(
      appId,
      appCertificate,
      channel,
      uid,
      RtcRole.PUBLISHER,
      TOKEN_EXPIRATION_SECONDS,
      TOKEN_EXPIRATION_SECONDS,
    );

    return NextResponse.json({ token, uid, channel, ticket });
  } catch (error) {
    console.error('Failed to generate voice token:', error);
    return NextResponse.json(
      { error: 'Failed to generate voice token.' },
      { status: 500 },
    );
  }
}

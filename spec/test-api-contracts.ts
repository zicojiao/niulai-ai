import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET as generateToken } from '../app/api/generate-agora-token/route';
import { POST as inviteAgent } from '../app/api/invite-agent/route';
import {
  FISH_AUDIO_BACKEND,
  FISH_AUDIO_REFERENCE_ID,
  createFishAudioTts,
} from '../lib/fishAudio';
import { POST as stopConversation } from '../app/api/stop-conversation/route';

const originalAppId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
const originalCertificate = process.env.NEXT_AGORA_APP_CERTIFICATE;
const originalFishAudioKey = process.env.FISH_AUDIO_API_KEY;
const originalTicketSecret = process.env.CALL_TICKET_SECRET;

function invite(body: unknown) {
  return inviteAgent(
    new NextRequest('http://localhost/api/invite-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function main() {
  try {
    delete process.env.NEXT_PUBLIC_AGORA_APP_ID;
    delete process.env.NEXT_AGORA_APP_CERTIFICATE;
    process.env.CALL_TICKET_SECRET = 'ticket-test-secret';

    const missingCredentials = await generateToken(
      new NextRequest('http://localhost/api/generate-agora-token'),
    );
    assert.equal(missingCredentials.status, 500);
    assert.deepEqual(await missingCredentials.json(), {
      error: '语音服务未配置。',
    });

    process.env.NEXT_PUBLIC_AGORA_APP_ID = '0'.repeat(32);
    process.env.NEXT_AGORA_APP_CERTIFICATE = '1'.repeat(32);

    // A caller cannot name the channel or uid — the server always mints them.
    const tokenResponse = await generateToken(
      new NextRequest(
        'http://localhost/api/generate-agora-token?channel=attacker_channel&uid=7',
      ),
    );
    assert.equal(tokenResponse.status, 200);
    const tokenPayload = (await tokenResponse.json()) as Record<string, unknown>;
    assert.notEqual(tokenPayload.channel, 'attacker_channel');
    assert.notEqual(tokenPayload.uid, '7');
    assert.match(String(tokenPayload.channel), /^niulai-ai-/);
    assert.equal(typeof tokenPayload.token, 'string');
    assert.ok(String(tokenPayload.token).length > 40);
    assert.equal(typeof tokenPayload.ticket, 'string');
    assert.equal('appCertificate' in tokenPayload, false);
    assert.equal('certificate' in tokenPayload, false);

    const channel = String(tokenPayload.channel);
    const uid = String(tokenPayload.uid);
    const ticket = String(tokenPayload.ticket);

    // Renewal reuses the ticket and lands on the same channel and uid.
    const renewed = await generateToken(
      new NextRequest(
        `http://localhost/api/generate-agora-token?ticket=${encodeURIComponent(ticket)}`,
      ),
    );
    assert.equal(renewed.status, 200);
    const renewedPayload = (await renewed.json()) as Record<string, unknown>;
    assert.equal(renewedPayload.channel, channel);
    assert.equal(renewedPayload.uid, uid);
    assert.notEqual(renewedPayload.token, tokenPayload.token);

    const forgedRenewal = await generateToken(
      new NextRequest(
        'http://localhost/api/generate-agora-token?ticket=attacker_channel.42.99999999999.deadbeef',
      ),
    );
    assert.equal(forgedRenewal.status, 403);

    const invalidInvite = await invite({
      requester_id: 42,
      channel_name: channel,
      ticket,
    });
    assert.equal(invalidInvite.status, 400);

    const unsafeInvite = await invite({
      requester_id: uid,
      channel_name: '../niulai_test',
      ticket,
    });
    assert.equal(unsafeInvite.status, 400);

    const ticketlessInvite = await invite({
      requester_id: uid,
      channel_name: channel,
    });
    assert.equal(ticketlessInvite.status, 400);

    // A valid ticket cannot be replayed against a different channel or uid.
    const wrongChannelInvite = await invite({
      requester_id: uid,
      channel_name: 'niulai_other',
      ticket,
    });
    assert.equal(wrongChannelInvite.status, 403);

    const wrongUidInvite = await invite({
      requester_id: '999',
      channel_name: channel,
      ticket,
    });
    assert.equal(wrongUidInvite.status, 403);

    const forgedInvite = await invite({
      requester_id: uid,
      channel_name: channel,
      ticket: `${channel}.${uid}.99999999999.${'0'.repeat(64)}`,
    });
    assert.equal(forgedInvite.status, 403);

    delete process.env.FISH_AUDIO_API_KEY;
    const missingFishCredentials = await invite({
      requester_id: uid,
      channel_name: channel,
      ticket,
    });
    assert.equal(missingFishCredentials.status, 500);
    assert.deepEqual(await missingFishCredentials.json(), {
      error: 'Missing required environment variable: FISH_AUDIO_API_KEY',
    });

    process.env.FISH_AUDIO_API_KEY = 'fish-test-key';
    assert.deepEqual(createFishAudioTts().toConfig(), {
      vendor: 'fishaudio',
      params: {
        api_key: 'fish-test-key',
        reference_id: FISH_AUDIO_REFERENCE_ID,
        backend: FISH_AUDIO_BACKEND,
      },
    });
    assert.equal(FISH_AUDIO_REFERENCE_ID, 'd733401d62fd43a3b889792e9fc3084a');
    assert.equal(FISH_AUDIO_BACKEND, 's2.1-pro');

    const invalidStop = await stopConversation(
      new Request('http://localhost/api/stop-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: '', stop_token: 'anything' }),
      }),
    );
    assert.equal(invalidStop.status, 400);

    const ticketlessStop = await stopConversation(
      new Request('http://localhost/api/stop-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: 'agent_abc' }),
      }),
    );
    assert.equal(ticketlessStop.status, 400);

    // Knowing an agent id is not enough to hang up someone else's call.
    const forgedStop = await stopConversation(
      new Request('http://localhost/api/stop-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: 'agent_abc',
          stop_token: 'f'.repeat(64),
        }),
      }),
    );
    assert.equal(forgedStop.status, 403);

    console.log('Agora API contract checks passed.');
  } finally {
    if (originalAppId === undefined) {
      delete process.env.NEXT_PUBLIC_AGORA_APP_ID;
    } else {
      process.env.NEXT_PUBLIC_AGORA_APP_ID = originalAppId;
    }
    if (originalCertificate === undefined) {
      delete process.env.NEXT_AGORA_APP_CERTIFICATE;
    } else {
      process.env.NEXT_AGORA_APP_CERTIFICATE = originalCertificate;
    }
    if (originalFishAudioKey === undefined) {
      delete process.env.FISH_AUDIO_API_KEY;
    } else {
      process.env.FISH_AUDIO_API_KEY = originalFishAudioKey;
    }
    if (originalTicketSecret === undefined) {
      delete process.env.CALL_TICKET_SECRET;
    } else {
      process.env.CALL_TICKET_SECRET = originalTicketSecret;
    }
  }
}

void main();

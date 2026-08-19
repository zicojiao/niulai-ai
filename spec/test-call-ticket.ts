import assert from 'node:assert/strict';
import {
  CALL_TICKET_TTL_SECONDS,
  isCallTicketFor,
  isStopTokenFor,
  issueCallTicket,
  issueStopToken,
  readCallTicket,
} from '../lib/callTicket';

// The secret is read per call, so setting it here covers every helper below.
const originalSecret = process.env.CALL_TICKET_SECRET;
process.env.CALL_TICKET_SECRET = 'ticket-test-secret';

try {
  const ticket = issueCallTicket('niulai_test', '42');

  // A ticket only authorises the exact channel and uid it was issued for.
  assert.deepEqual(readCallTicket(ticket), {
    channel: 'niulai_test',
    uid: '42',
  });
  assert.equal(isCallTicketFor(ticket, 'niulai_test', '42'), true);
  assert.equal(isCallTicketFor(ticket, 'someone_elses_channel', '42'), false);
  assert.equal(isCallTicketFor(ticket, 'niulai_test', '43'), false);

  // Tampering with any field invalidates the signature.
  const [channel, uid, expires, mac] = ticket.split('.');
  assert.equal(readCallTicket(`other_channel.${uid}.${expires}.${mac}`), null);
  assert.equal(readCallTicket(`${channel}.99.${expires}.${mac}`), null);
  assert.equal(
    readCallTicket(`${channel}.${uid}.${Number(expires) + 3600}.${mac}`),
    null,
  );
  assert.equal(readCallTicket(`${channel}.${uid}.${expires}.${'0'.repeat(64)}`), null);

  // Malformed input is rejected rather than throwing.
  assert.equal(readCallTicket(undefined), null);
  assert.equal(readCallTicket(''), null);
  assert.equal(readCallTicket('a.b.c'), null);
  assert.equal(readCallTicket('a.b.c.d.e'), null);

  // Expiry is enforced against the caller-supplied clock.
  const justExpired = Date.now() + (CALL_TICKET_TTL_SECONDS + 1) * 1000;
  assert.equal(readCallTicket(ticket, justExpired), null);
  assert.notEqual(readCallTicket(ticket, Date.now() + 60_000), null);

  // A ticket signed under a different secret is not accepted.
  process.env.CALL_TICKET_SECRET = 'a-different-secret';
  assert.equal(readCallTicket(ticket), null);
  process.env.CALL_TICKET_SECRET = 'ticket-test-secret';

  // Stop tokens are bound to a single agent id.
  const stopToken = issueStopToken('agent_abc');
  assert.equal(isStopTokenFor('agent_abc', stopToken), true);
  assert.equal(isStopTokenFor('agent_xyz', stopToken), false);
  assert.equal(isStopTokenFor('agent_abc', 'not-a-token'), false);
  assert.equal(isStopTokenFor('agent_abc', undefined), false);

  // A missing secret fails loudly instead of signing with a blank key.
  delete process.env.CALL_TICKET_SECRET;
  assert.throws(
    () => issueCallTicket('niulai_test', '42'),
    /CALL_TICKET_SECRET/,
  );

  console.log('Call ticket checks passed.');
} finally {
  if (originalSecret === undefined) {
    delete process.env.CALL_TICKET_SECRET;
  } else {
    process.env.CALL_TICKET_SECRET = originalSecret;
  }
}

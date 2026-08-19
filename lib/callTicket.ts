import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed tickets bind the three call endpoints into one ordered chain:
 * the token endpoint issues a ticket for a freshly minted channel, and only
 * the holder of that ticket can invite an agent into it or renew its token.
 * Stopping an agent needs a separate signature over the agent id, so a caller
 * can only hang up the call they started.
 *
 * The ticket outlives the five-minute call limit because the RTC token
 * renewal path may need it up to ten minutes in.
 */
export const CALL_TICKET_TTL_SECONDS = 15 * 60;

function ticketSecret() {
  const value = process.env.CALL_TICKET_SECRET;
  if (!value) {
    throw new Error(
      'Missing required environment variable: CALL_TICKET_SECRET',
    );
  }
  return value;
}

function sign(payload: string) {
  return createHmac('sha256', ticketSecret()).update(payload).digest('hex');
}

function matches(expected: string, actual: string) {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return (
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes)
  );
}

export function issueCallTicket(
  channel: string,
  uid: string,
  now = Date.now(),
) {
  const expires = Math.floor(now / 1000) + CALL_TICKET_TTL_SECONDS;
  const payload = `${channel}.${uid}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

export interface CallTicketClaims {
  channel: string;
  uid: string;
}

/**
 * Returns the channel and uid a ticket was issued for, or null when the
 * ticket is malformed, expired, or not signed by this server.
 */
export function readCallTicket(
  ticket: unknown,
  now = Date.now(),
): CallTicketClaims | null {
  if (typeof ticket !== 'string') return null;
  const parts = ticket.split('.');
  if (parts.length !== 4) return null;

  const [channel, uid, expires, mac] = parts;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(channel)) return null;
  if (!/^[1-9][0-9]{0,9}$/.test(uid)) return null;
  if (!/^[0-9]{1,12}$/.test(expires)) return null;
  if (Number(expires) < Math.floor(now / 1000)) return null;
  if (!matches(sign(`${channel}.${uid}.${expires}`), mac)) return null;

  return { channel, uid };
}

export function isCallTicketFor(
  ticket: unknown,
  channel: string,
  uid: string,
  now = Date.now(),
) {
  const claims = readCallTicket(ticket, now);
  return claims !== null && claims.channel === channel && claims.uid === uid;
}

export function issueStopToken(agentId: string) {
  return sign(`stop.${agentId}`);
}

export function isStopTokenFor(agentId: string, stopToken: unknown) {
  if (typeof stopToken !== 'string') return false;
  return matches(issueStopToken(agentId), stopToken);
}

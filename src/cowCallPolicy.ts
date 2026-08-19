import type { CowCallPhase } from './cow/cowEvents';

export const COW_CALL_LIMIT_SECONDS = 5 * 60;

export function canStartCowCall(phase: CowCallPhase) {
  return phase === 'idle' || phase === 'error';
}

export function canEndCowCall(phase: CowCallPhase) {
  return phase === 'connecting' || phase === 'connected';
}

export function cowSecondsRemaining(deadline: number, now: number) {
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function formatCowCallTime(seconds: number) {
  const safe = Math.max(0, Math.min(COW_CALL_LIMIT_SECONDS, Math.floor(seconds)));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(
    safe % 60,
  ).padStart(2, '0')}`;
}

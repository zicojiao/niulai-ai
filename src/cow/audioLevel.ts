/**
 * Agora reports `getVolumeLevel()` as a 0..1 RMS-ish figure that sits very low
 * for ordinary speech, so a raw reading barely moves the jaw. This expands the
 * useful range and lets the level fall away more slowly than it rises, which is
 * what makes a mouth look like it is forming words instead of flickering.
 */
export const LEVEL_FLOOR = 0.012;
export const LEVEL_CEILING = 0.28;
export const CURVE = 0.6;
export const ATTACK = 0.65;
export const RELEASE = 0.22;

export function normaliseLevel(raw: number) {
  if (!Number.isFinite(raw) || raw <= LEVEL_FLOOR) return 0;
  const span = (raw - LEVEL_FLOOR) / (LEVEL_CEILING - LEVEL_FLOOR);
  // A gentle curve: quiet syllables still open the mouth a little.
  return Math.pow(Math.min(1, span), CURVE);
}

export function smoothLevel(previous: number, raw: number) {
  const target = normaliseLevel(raw);
  const rate = target > previous ? ATTACK : RELEASE;
  return previous + (target - previous) * rate;
}

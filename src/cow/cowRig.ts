/**
 * The bull's performance, as pure state -> pose maths.
 *
 * The sculpt has no skeleton, so every expression is a weighted deformation
 * driven from three signals: how loudly the agent is speaking, how loudly the
 * caller is speaking, and where the pointer is. Keeping the maths here (rather
 * than inside the render loop) makes the timing testable.
 */

export type CowMood = 'idle' | 'waking' | 'listening' | 'talking' | 'upset';

export type CowRigInput = {
  /** Seconds since the scene started. */
  time: number;
  /** Seconds since the previous frame, clamped by the caller. */
  delta: number;
  mood: CowMood;
  /** 0..1 loudness of the agent's voice. */
  agentLevel: number;
  /** 0..1 loudness of the caller's microphone. */
  callerLevel: number;
  /** Pointer position in normalised device coordinates, -1..1. */
  pointer: { x: number; y: number };
};

export type CowPose = {
  jaw: number;
  blink: number;
  brow: number;
  headTurn: { x: number; y: number; z: number };
  breath: number;
  bodyLean: number;
};

export type CowRigState = {
  jaw: number;
  brow: number;
  blink: number;
  headTurn: { x: number; y: number; z: number };
  /** Scene time at which the next blink starts. */
  nextBlink: number;
  blinkStart: number;
};

export const BLINK_DURATION = 0.16;

export function createRigState(): CowRigState {
  return {
    jaw: 0,
    brow: 0,
    blink: 0,
    headTurn: { x: 0, y: 0, z: 0 },
    nextBlink: 1.6,
    blinkStart: -1,
  };
}

/** Frame-rate independent exponential approach: `rate` is per second. */
export function approach(current: number, target: number, rate: number, delta: number) {
  return current + (target - current) * (1 - Math.exp(-rate * delta));
}

/**
 * Blinks land on a loose rhythm rather than a timer, and double up now and then
 * so the bull never looks metronomic.
 */
function advanceBlink(state: CowRigState, time: number) {
  if (state.blinkStart >= 0) {
    const t = (time - state.blinkStart) / BLINK_DURATION;
    if (t >= 1) {
      state.blinkStart = -1;
      state.blink = 0;
    } else {
      state.blink = Math.sin(Math.min(1, t) * Math.PI);
      return;
    }
  }
  if (time >= state.nextBlink) {
    state.blinkStart = time;
    // A short gap reads as a double blink; a long one as an idle beat.
    state.nextBlink = time + (Math.random() < 0.22 ? 0.32 : 2.4 + Math.random() * 3.4);
  }
}

export function updateRig(state: CowRigState, input: CowRigInput): CowPose {
  const { time, delta, mood, agentLevel, callerLevel, pointer } = input;

  advanceBlink(state, time);

  // Jaw. Voice loudness drives the opening directly, with a small idle chew so
  // quiet syllables still register, and a fast attack / slower release so the
  // mouth snaps open on a consonant and eases shut.
  const speaking = mood === 'talking';
  const chatter = speaking
    ? 0.5 + 0.5 * Math.sin(time * 23.0 + Math.sin(time * 7.3) * 2.0)
    : 0;
  const jawTarget = speaking
    ? Math.min(1, agentLevel * 1.65 * (0.55 + 0.45 * chatter) + 0.06)
    : 0;
  state.jaw = approach(state.jaw, jawTarget, jawTarget > state.jaw ? 26 : 11, delta);

  // Brow. Rises with the agent's voice, knits when the bull is put out, and
  // lifts a little whenever the caller is the one talking — attention.
  const browTarget =
    mood === 'upset'
      ? -0.85
      : speaking
        ? 0.25 + agentLevel * 0.7
        : Math.min(0.85, callerLevel * 1.4);
  state.brow = approach(state.brow, browTarget, 7, delta);

  // Head. Idle drift plus a lean toward the pointer, so the bull tracks whoever
  // is at the keyboard; it nods on its own stresses while speaking.
  const idleYaw = Math.sin(time * 0.42) * 0.05 + Math.sin(time * 0.17) * 0.03;
  const idlePitch = Math.sin(time * 0.31 + 1.1) * 0.035;
  const nod = speaking ? Math.sin(time * 9.5) * agentLevel * 0.055 : 0;
  const targetTurn = {
    x: idleYaw + pointer.x * 0.3,
    y: idlePitch - pointer.y * 0.17 + nod,
    z: Math.sin(time * 0.23) * 0.02 + (mood === 'listening' ? pointer.x * 0.06 : 0),
  };
  state.headTurn.x = approach(state.headTurn.x, targetTurn.x, 3.4, delta);
  state.headTurn.y = approach(state.headTurn.y, targetTurn.y, 3.4, delta);
  state.headTurn.z = approach(state.headTurn.z, targetTurn.z, 2.6, delta);

  // Breath. Slow and deep at rest, quicker on a live call, and it holds under
  // the bull's own voice the way a real breath does.
  const rate = mood === 'idle' ? 0.62 : 1.05;
  const depth = (mood === 'idle' ? 0.013 : 0.009) * (speaking ? 0.45 : 1);
  const breath = Math.sin(time * rate * Math.PI) * depth;

  return {
    jaw: state.jaw,
    blink: state.blink,
    brow: state.brow,
    headTurn: { ...state.headTurn },
    breath,
    bodyLean: Math.sin(time * 0.29) * 0.012 + pointer.x * 0.03,
  };
}

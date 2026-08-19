import assert from 'node:assert/strict';
import {
  BLINK_DURATION,
  approach,
  createRigState,
  updateRig,
  type CowMood,
  type CowRigInput,
} from '../src/cow/cowRig';
import { normaliseLevel, smoothLevel, LEVEL_FLOOR } from '../src/cow/audioLevel';
import {
  COW_CALL_LIMIT_SECONDS,
  canEndCowCall,
  canStartCowCall,
  cowSecondsRemaining,
  formatCowCallTime,
} from '../src/cowCallPolicy';

function frames(
  mood: CowMood,
  agentLevel: number,
  count: number,
  overrides: Partial<CowRigInput> = {},
) {
  const state = createRigState();
  // Blinks are random; hold them off so jaw and brow assertions stay stable.
  state.nextBlink = Number.POSITIVE_INFINITY;
  const delta = 1 / 60;
  let pose = updateRig(state, {
    time: 0,
    delta,
    mood,
    agentLevel,
    callerLevel: 0,
    pointer: { x: 0, y: 0 },
    ...overrides,
  });
  for (let i = 1; i < count; i += 1) {
    pose = updateRig(state, {
      time: i * delta,
      delta,
      mood,
      agentLevel,
      callerLevel: 0,
      pointer: { x: 0, y: 0 },
      ...overrides,
    });
  }
  return pose;
}

// The jaw only moves for the agent's own voice.
assert.equal(frames('listening', 1, 60).jaw, 0);
assert.equal(frames('idle', 1, 60).jaw, 0);
assert.ok(frames('talking', 1, 60).jaw > 0.5, 'a loud agent opens the jaw');
assert.ok(
  frames('talking', 0.2, 60).jaw < frames('talking', 0.9, 60).jaw,
  'a quieter agent opens the jaw less',
);

// The mouth snaps open faster than it eases shut, so consonants read.
const attackState = createRigState();
attackState.nextBlink = Number.POSITIVE_INFINITY;
const base: CowRigInput = {
  time: 0,
  delta: 1 / 60,
  mood: 'talking',
  agentLevel: 1,
  callerLevel: 0,
  pointer: { x: 0, y: 0 },
};
updateRig(attackState, base);
const opened = attackState.jaw;
updateRig(attackState, { ...base, time: 1 / 60, agentLevel: 0 });
const closing = attackState.jaw;
assert.ok(opened > 0, 'the jaw opens on the first loud frame');
assert.ok(closing > 0, 'the jaw does not slam shut in a single frame');
assert.ok(closing < opened);

// Being put out knits the brow; hearing the caller lifts it.
assert.ok(frames('upset', 0, 90).brow < -0.5);
assert.ok(
  frames('listening', 0, 90, { callerLevel: 0.8 }).brow > 0.4,
  'the bull perks up while the caller speaks',
);

// A blink is a full open -> shut -> open sweep inside its duration.
const blinkState = createRigState();
blinkState.nextBlink = 0;
const atStart = updateRig(blinkState, { ...base, mood: 'idle', agentLevel: 0 });
const atMiddle = updateRig(blinkState, {
  ...base,
  mood: 'idle',
  agentLevel: 0,
  time: BLINK_DURATION / 2,
});
const atEnd = updateRig(blinkState, {
  ...base,
  mood: 'idle',
  agentLevel: 0,
  time: BLINK_DURATION * 1.01,
});
assert.ok(atStart.blink < 0.2, 'the lid starts open');
assert.ok(atMiddle.blink > 0.9, 'the lid is shut halfway through');
assert.equal(atEnd.blink, 0, 'the lid reopens');

// approach() must not depend on frame rate: one long step and many short ones
// have to land in the same place.
const oneStep = approach(0, 1, 6, 0.5);
let manySteps = 0;
for (let i = 0; i < 30; i += 1) manySteps = approach(manySteps, 1, 6, 0.5 / 30);
assert.ok(Math.abs(oneStep - manySteps) < 1e-9);

// Audio levels: silence is silent, and the curve expands Agora's cramped range.
assert.equal(normaliseLevel(0), 0);
assert.equal(normaliseLevel(LEVEL_FLOOR), 0);
assert.equal(normaliseLevel(Number.NaN), 0);
assert.equal(normaliseLevel(1), 1);
assert.ok(
  normaliseLevel(0.06) > 0.3,
  'ordinary speech has to move the jaw, not just peaks',
);
const rise = smoothLevel(0, 1) - 0;
const fall = 1 - smoothLevel(1, 0);
assert.ok(rise > fall, 'the mouth opens faster than it closes');

// Call policy.
assert.equal(canStartCowCall('idle'), true);
assert.equal(canStartCowCall('error'), true);
assert.equal(canStartCowCall('connected'), false);
assert.equal(canStartCowCall('ending'), false);
assert.equal(canEndCowCall('connecting'), true);
assert.equal(canEndCowCall('connected'), true);
assert.equal(canEndCowCall('idle'), false);
assert.equal(cowSecondsRemaining(10_000, 4_400), 6);
assert.equal(cowSecondsRemaining(1_000, 9_000), 0);
assert.equal(cowSecondsRemaining(Number.NaN, 0), 0);
assert.equal(formatCowCallTime(COW_CALL_LIMIT_SECONDS), '05:00');
assert.equal(formatCowCallTime(61), '01:01');
assert.equal(formatCowCallTime(-5), '00:00');
assert.equal(formatCowCallTime(9_999), '05:00');

console.log('Niulai rig, audio level, and call policy checks passed.');

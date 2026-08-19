import { createCowScene, type CowScene } from './createCowScene';
import {
  COW_AUDIO_LEVEL_EVENT,
  COW_CALL_STATE_EVENT,
  COW_SCENE_READY_EVENT,
  requestCowCallToggle,
  type CowAudioLevelDetail,
  type CowCallStateDetail,
} from './cowEvents';
import type { CowMood } from './cowRig';

/**
 * Only count the bull as "talking" while the agent's voice is actually
 * carrying, otherwise it chews on the silence between turns.
 */
function moodFor(phase: CowCallStateDetail['phase'], agentLevel: number): CowMood {
  if (phase === 'error') return 'upset';
  if (phase === 'connecting') return 'waking';
  if (phase === 'connected') return agentLevel > 0.045 ? 'talking' : 'listening';
  return 'idle';
}

async function boot() {
  const canvas = document.getElementById('cow-scene');
  if (!(canvas instanceof HTMLCanvasElement)) return;

  let scene: CowScene;
  try {
    scene = await createCowScene(canvas, requestCowCallToggle);
  } catch (error) {
    console.error('The 牛来 scene could not start:', error);
    document.getElementById('cow-error')?.removeAttribute('hidden');
    document.body.classList.remove('is-booting');
    return;
  }

  let phase: CowCallStateDetail['phase'] = 'idle';
  let agentLevel = 0;

  const handleCallState = (event: Event) => {
    const detail = (event as CustomEvent<CowCallStateDetail>).detail;
    if (!detail) return;
    phase = detail.phase;
    if (phase !== 'connected') agentLevel = 0;
    scene.setMood(moodFor(phase, agentLevel));
  };

  const handleLevels = (event: Event) => {
    const detail = (event as CustomEvent<CowAudioLevelDetail>).detail;
    if (!detail) return;
    agentLevel = detail.agent;
    scene.setLevels(detail.agent, detail.caller);
    scene.setMood(moodFor(phase, agentLevel));
  };

  window.addEventListener(COW_CALL_STATE_EVENT, handleCallState);
  window.addEventListener(COW_AUDIO_LEVEL_EVENT, handleLevels);

  document.body.classList.remove('is-booting');
  window.dispatchEvent(new Event(COW_SCENE_READY_EVENT));
}

void boot();

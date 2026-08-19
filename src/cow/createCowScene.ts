import {
  AmbientLight,
  BackSide,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PointLight,
  Raycaster,
  NeutralToneMapping,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import palette from './cowPalette.json';
import { createCowMaterial, type CowUniforms } from './cowMaterial';
import { loadCowMesh } from './loadCowMesh';
import { createRigState, updateRig, type CowMood } from './cowRig';
import { createGroundShadow } from './groundShadow';

export type CowScene = {
  setMood: (mood: CowMood) => void;
  setLevels: (agent: number, caller: number) => void;
  dispose: () => void;
};

const MAX_DELTA = 1 / 20;

export async function createCowScene(
  canvas: HTMLCanvasElement,
  onPick: () => void,
  signal?: AbortSignal,
): Promise<CowScene> {
  const geometry = await loadCowMesh(undefined, signal);

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = SRGBColorSpace;
  // ACES swings this bull's saturated gold hard towards orange. The Khronos
  // neutral curve holds the film's hue while still rolling off the highlights.
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.05, 40);

  const uniforms: CowUniforms = {
    uJaw: { value: 0 },
    uBlink: { value: 0 },
    uBrow: { value: 0 },
    uHeadTurn: { value: new Vector3() },
    uBreath: { value: 0 },
  };

  const bull = new Group();
  const body = new Mesh(geometry, createCowMaterial(uniforms));
  bull.add(body);

  // The sculpt is a sealed solid, so a dropped jaw would otherwise look through
  // the head. A dark shell behind the lips gives the opening something to be.
  const mouthCavity = new Mesh(
    new SphereGeometry(1, 24, 16),
    new MeshBasicMaterial({
      color: new Color(palette.colours.mouth).multiplyScalar(0.34),
      side: BackSide,
    }),
  );
  mouthCavity.scale.set(0.075, 0.055, 0.075);
  mouthCavity.position.set(0, 0.632, 0.165);
  bull.add(mouthCavity);

  const shadow = createGroundShadow();
  bull.add(shadow);
  scene.add(bull);

  // Soft studio set: a broad warm key front-left, a cool rim behind to peel the
  // silhouette off the paper, and a weak upward fill so the muzzle's underside
  // and the insides of the legs never crush to black.
  const key = new DirectionalLight(0xfff4e2, 2.05);
  key.position.set(-1.4, 2.1, 2.6);
  const rim = new DirectionalLight(0xbcd8ff, 1.15);
  rim.position.set(2.0, 1.5, -2.1);
  const fill = new DirectionalLight(0xffe6c4, 0.7);
  fill.position.set(1.5, -0.2, 1.8);
  const bounce = new PointLight(0xffcf90, 0.5, 4, 2);
  bounce.position.set(0, 0.06, 0.85);
  scene.add(key, rim, fill, bounce, new AmbientLight(0xd8e2ec, 1.15));

  const pointer = { x: 0, y: 0 };
  const pointerTarget = { x: 0, y: 0 };
  const raycaster = new Raycaster();
  const ndc = new Vector2();

  let mood: CowMood = 'idle';
  let agentLevel = 0;
  let callerLevel = 0;
  const rig = createRigState();

  // Turntable. Dragging spins the bull and hands it momentum on release; left
  // alone it drifts back to face the camera so the conversation stays face to
  // face. `spin` is the offset from front-on, not an absolute heading.
  let spin = 0;
  let spinVelocity = 0;
  let dragPointerId: number | null = null;
  let dragLastX = 0;
  let dragDistance = 0;

  const handlePointerMove = (event: PointerEvent) => {
    pointerTarget.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointerTarget.y = (event.clientY / window.innerHeight) * 2 - 1;

    if (event.pointerId !== dragPointerId) return;
    const travel = event.clientX - dragLastX;
    dragLastX = event.clientX;
    dragDistance += Math.abs(travel);
    spin += (travel / window.innerWidth) * Math.PI * 2.6;
    spinVelocity = (travel / window.innerWidth) * Math.PI * 2.6;
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    dragPointerId = event.pointerId;
    dragLastX = event.clientX;
    dragDistance = 0;
    spinVelocity = 0;
    canvas.setPointerCapture?.(event.pointerId);
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (event.pointerId !== dragPointerId) return;
    dragPointerId = null;
    canvas.releasePointerCapture?.(event.pointerId);
    // A drag is a look, not a tap: only a near-stationary release starts a call.
    if (dragDistance > 6) return;
    ndc.set(
      (event.clientX / window.innerWidth) * 2 - 1,
      -((event.clientY / window.innerHeight) * 2 - 1),
    );
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.intersectObject(body, false).length > 0) onPick();
  };

  const resize = () => {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Portrait layouts need the camera pulled back or the horns crop.
    const portrait = height > width;
    // Framing the bull a little above centre leaves the lower third for the
    // call console without shrinking it.
    camera.position.set(0, 0.5, portrait ? 3.15 : 2.4);
    camera.lookAt(0, 0.43, 0);
    camera.updateProjectionMatrix();
  };

  window.addEventListener('pointermove', handlePointerMove, { passive: true });
  canvas.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerUp);
  window.addEventListener('resize', resize);
  resize();

  let previous = performance.now();
  let frame = 0;
  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    const delta = Math.min(MAX_DELTA, (now - previous) / 1000);
    previous = now;
    const time = now / 1000;

    pointer.x += (pointerTarget.x - pointer.x) * Math.min(1, delta * 4);
    pointer.y += (pointerTarget.y - pointer.y) * Math.min(1, delta * 4);

    if (dragPointerId === null) {
      // Coast, then ease back to front-on.
      spin += spinVelocity;
      spinVelocity *= Math.exp(-2.4 * delta);
      if (Math.abs(spinVelocity) < 1e-4) spinVelocity = 0;
      spin *= Math.exp(-(spinVelocity === 0 ? 0.55 : 0.05) * delta);
    }

    // While turned away the bull can no longer see the pointer, so it stops
    // tracking it and just drifts.
    const facing = Math.max(0, Math.cos(spin));
    const pose = updateRig(rig, {
      time,
      delta,
      mood,
      agentLevel,
      callerLevel,
      pointer: { x: pointer.x * facing, y: pointer.y * facing },
    });

    uniforms.uJaw.value = pose.jaw;
    uniforms.uBlink.value = pose.blink;
    uniforms.uBrow.value = pose.brow;
    uniforms.uHeadTurn.value.set(pose.headTurn.x, pose.headTurn.y, pose.headTurn.z);
    uniforms.uBreath.value = pose.breath;

    bull.rotation.y = spin + pose.bodyLean;
    bull.position.y = Math.sin(time * (mood === 'idle' ? 0.62 : 1.05) * Math.PI) * 0.004;
    mouthCavity.position.y = 0.632 - pose.jaw * 0.012;

    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(tick);

  return {
    setMood: (next) => {
      mood = next;
    },
    setLevels: (agent, caller) => {
      agentLevel = agent;
      callerLevel = caller;
    },
    dispose: () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      window.removeEventListener('resize', resize);
      geometry.dispose();
      body.material.dispose();
      mouthCavity.geometry.dispose();
      mouthCavity.material.dispose();
      shadow.geometry.dispose();
      shadow.material.dispose();
      renderer.dispose();
    },
  };
}

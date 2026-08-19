import { Color, MeshStandardMaterial, Vector3 } from 'three';
import palette from './cowPalette.json';

export type CowUniforms = {
  uJaw: { value: number };
  uBlink: { value: number };
  uBrow: { value: number };
  uHeadTurn: { value: Vector3 };
  uBreath: { value: number };
};

// three.js colour management already decodes a hex literal from sRGB into the
// linear working space, which is what the shader needs. Converting again here
// squares the transfer function and drags the bull's gold towards rust.
const colour = (hex: string) => new Color(hex);

/** Injects the region masks as GLSL constants so the shader stays branch-cheap. */
function glslVec3(v: readonly number[]) {
  return `vec3(${v.map((n) => n.toFixed(6)).join(', ')})`;
}

function glslColour(hex: string) {
  const c = colour(hex);
  return `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;
}

const { shape, rig, colours } = palette;

const COMMON = /* glsl */ `
  uniform float uJaw;
  uniform float uBlink;
  uniform float uBrow;
  uniform vec3 uHeadTurn;
  uniform float uBreath;
  varying vec3 vSculpt;

  const vec3 NECK_PIVOT = ${glslVec3(rig.neckPivot)};
  const vec3 JAW_HINGE = ${glslVec3(rig.jawHinge)};
  const vec3 TORSO_CENTRE = ${glslVec3(rig.torsoCentre)};
  const float MOUTH_LINE = ${rig.mouthLine.toFixed(4)};
  const float JAW_LINE = ${rig.jawLine.toFixed(4)};
  const float JAW_LINE_DROP = ${rig.jawLineDrop.toFixed(4)};

  // How much of the head a point belongs to. A sphere cannot do this: the bull
  // has no neck, so the boundary is a surface that dips towards the front,
  // taking in the chin while leaving the chest behind it alone.
  float headWeight(vec3 p) {
    float boundary = JAW_LINE - JAW_LINE_DROP * clamp(p.z / 0.22, -1.0, 1.0);
    return smoothstep(boundary - 0.05, boundary + 0.06, p.y);
  }

  // The lower lip and chin: below the mouth line, on the front of the head.
  float jawWeight(vec3 p) {
    return smoothstep(MOUTH_LINE + 0.012, MOUTH_LINE - 0.055, p.y)
      * headWeight(p)
      * smoothstep(0.02, 0.10, p.z);
  }

  mat3 rotateX(float a) {
    float s = sin(a); float c = cos(a);
    return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
  }
  mat3 rotateY(float a) {
    float s = sin(a); float c = cos(a);
    return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
  }
  mat3 rotateZ(float a) {
    float s = sin(a); float c = cos(a);
    return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0);
  }
`;

// Runs with <beginnormal_vertex>, not <begin_vertex>: three.js consumes
// objectNormal into transformedNormal before the position block, so the rig has
// to move the normal first and hand the position on afterwards.
const VERTEX_DEFORM = /* glsl */ `
  vec3 sculpt = position;
  vSculpt = sculpt;

  vec3 deformed = sculpt;
  vec3 deformedNormal = objectNormal;

  // 1. Jaw. The chin swings back and down about a hinge level with the ears.
  float jaw = jawWeight(sculpt) * uJaw;
  if (jaw > 0.0005) {
    mat3 hinge = rotateX(0.28 * jaw);
    deformed = JAW_HINGE + hinge * (deformed - JAW_HINGE);
    deformedNormal = mix(deformedNormal, hinge * deformedNormal, jaw);
  }

  // 2. Head. Yaw, pitch and roll around the base of the neck.
  float head = headWeight(sculpt);
  if (head > 0.0005) {
    mat3 turn = rotateY(uHeadTurn.x * head)
      * rotateX(uHeadTurn.y * head)
      * rotateZ(uHeadTurn.z * head);
    deformed = NECK_PIVOT + turn * (deformed - NECK_PIVOT);
    deformedNormal = normalize(mix(deformedNormal, turn * deformedNormal, head));
  }

  // 3. Breath. The barrel chest swells; the legs and head stay put.
  float chest = (1.0 - smoothstep(0.10, 0.30, abs(sculpt.y - TORSO_CENTRE.y)))
    * (1.0 - head);
  deformed += (deformed - TORSO_CENTRE) * uBreath * chest;

  niuDeformed = deformed;
  objectNormal = normalize(deformedNormal);
`;

// Every boundary is resolved to roughly one pixel with fwidth rather than a
// fixed world-space band: a fixed band that reads as a crisp seam on the eyes
// smears into a halo across something as broad as the muzzle.
const FRAGMENT_EDGES = /* glsl */ `
  // The width is capped: where a mask surface meets the sculpt at a glancing
  // angle fwidth explodes, and an honest one-pixel edge turns into a smear.
  float edge(float signedDistance, float limit) {
    float w = min(fwidth(signedDistance) * 0.75, limit) + 1e-6;
    return smoothstep(-w, w, signedDistance);
  }

  float insideEllipsoid(vec3 p, vec3 centre, vec3 radii) {
    vec3 d = (p - centre) / radii;
    return edge(1.0 - length(d), 0.035);
  }
`;

const FRAGMENT_PAINT = /* glsl */ `
  vec3 mirrored = vec3(abs(vSculpt.x), vSculpt.y, vSculpt.z);

  vec3 skin = ${glslColour(colours.hide)};
  float gloss = 0.86;

  // Muzzle, hands and hooves: the same warm bone colour.
  float muzzle = insideEllipsoid(vSculpt, ${glslVec3(shape.muzzle.centre)}, ${glslVec3(shape.muzzle.radii)});
  float hand = insideEllipsoid(mirrored, ${glslVec3(shape.hand.centre)}, ${glslVec3(shape.hand.radii)});
  float hoof = edge(${shape.hoofTop.toFixed(4)} - vSculpt.y, 0.004);
  float bone = max(muzzle, max(hand, hoof));
  skin = mix(skin, ${glslColour(colours.muzzle)}, bone);

  // Horns: a tapered capsule swept from the skull to the tip.
  vec3 hornBase = ${glslVec3(shape.horn.base)};
  vec3 hornAxis = ${glslVec3(shape.horn.tip)} - hornBase;
  float hornT = clamp(dot(mirrored - hornBase, hornAxis) / dot(hornAxis, hornAxis), 0.0, 1.0);
  float hornDist = distance(mirrored, hornBase + hornAxis * hornT);
  float hornRadius = mix(${shape.horn.baseRadius.toFixed(4)}, ${shape.horn.tipRadius.toFixed(4)}, hornT);
  float horn = edge(hornRadius - hornDist, 0.006);
  vec3 hornShade = mix(
    ${glslColour(colours.horn)},
    ${glslColour(colours.hornTip)},
    smoothstep(0.18, 0.95, hornT)
  );
  skin = mix(skin, hornShade, horn);
  gloss = mix(gloss, 0.52, horn);

  // Eyes. The lid sweeps down over the almond as uBlink rises, and the brow
  // rides with it so a squint reads on the whole face.
  vec3 eyeCentre = ${glslVec3(shape.sclera.centre)} + vec3(0.0, uBrow * 0.004, 0.0);
  vec3 eyeRadii = ${glslVec3(shape.sclera.radii)};
  float lidEdge = 1.0 - 2.0 * uBlink;
  float open = smoothstep(lidEdge + 0.12, lidEdge - 0.12, (mirrored.y - eyeCentre.y) / eyeRadii.y);
  float sclera = insideEllipsoid(mirrored, eyeCentre, eyeRadii) * open;
  float pupil = insideEllipsoid(mirrored, ${glslVec3(shape.pupil.centre)} + vec3(0.0, uBrow * 0.004, 0.0), ${glslVec3(shape.pupil.radii)}) * open;
  skin = mix(skin, ${glslColour(colours.sclera)}, sclera);
  skin = mix(skin, ${glslColour(colours.pupil)}, pupil);
  gloss = mix(gloss, 0.14, max(sclera, pupil));

  // Brows, painted last so they always sit on top of the eye. The tilt term
  // drops the inner end towards the nose, which is what gives the bull its
  // permanently unimpressed look.
  vec3 browCentre = ${glslVec3(shape.brow.centre)}
    + vec3(0.0, uBrow * 0.014 + (mirrored.x - ${shape.brow.centre[0].toFixed(4)}) * ${shape.brow.tilt.toFixed(4)}, 0.0);
  float brow = insideEllipsoid(mirrored, browCentre, ${glslVec3(shape.brow.radii)});
  skin = mix(skin, ${glslColour(colours.brow)}, brow);
  gloss = mix(gloss, 0.62, brow);

  // The top of the lower lip. It is hidden in the lip fold at rest, and the
  // swinging jaw rolls it into view — so painting it as mouth interior is what
  // turns a stretching surface into an opening mouth.
  float mouth = insideEllipsoid(vSculpt, ${glslVec3(rig.mouthCentre)}, ${glslVec3(rig.mouthRadii)})
    * smoothstep(MOUTH_LINE + 0.012, MOUTH_LINE - 0.010, vSculpt.y)
    * smoothstep(0.02, 0.30, uJaw);
  skin = mix(skin, ${glslColour(colours.mouth)}, mouth);
  gloss = mix(gloss, 0.35, mouth);

  diffuseColor.rgb *= skin;
  roughnessFactor *= gloss;
`;

/**
 * The sculpt arrives as one single-colour body, so the film's palette is
 * painted on analytically in the fragment shader — crisp at any zoom, and free
 * of the seams a baked vertex-colour pass would leave on a decimated mesh. The
 * same file drives the rig deformation, so the paint stays glued to the surface
 * as the jaw and head move.
 */
export function createCowMaterial(uniforms: CowUniforms) {
  const material = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvec3 niuDeformed;\n${COMMON}`)
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>\n${VERTEX_DEFORM}`,
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  transformed = niuDeformed;',
      );

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON}\n${FRAGMENT_EDGES}`)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\n${FRAGMENT_PAINT}`,
      );
  };

  // Any change to the injected source needs a fresh program key, so derive it
  // from the source rather than hand-bumping a version.
  const cacheKey =
    `niulai-${COMMON.length}-${VERTEX_DEFORM.length}` +
    `-${FRAGMENT_EDGES.length}-${FRAGMENT_PAINT.length}`;
  material.customProgramCacheKey = () => cacheKey;
  return material;
}

import { CircleGeometry, Mesh, ShaderMaterial } from 'three';

/**
 * A painted contact shadow rather than a shadow map: the bull stands on nothing
 * but a colour field, so all a real depth pass would buy is cost. A radial
 * falloff squashed along Z reads as a figure resting on a surface.
 */
export function createGroundShadow() {
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {},
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        float d = length((vUv - 0.5) * vec2(2.0, 2.35));
        float core = 1.0 - smoothstep(0.0, 0.42, d);
        float spread = 1.0 - smoothstep(0.0, 1.0, d);
        float alpha = core * 0.5 + spread * 0.28;
        gl_FragColor = vec4(vec3(0.05, 0.03, 0.02), alpha);
      }
    `,
  });

  const shadow = new Mesh(new CircleGeometry(0.42, 48), material);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.0015;
  shadow.renderOrder = -1;
  return shadow;
}

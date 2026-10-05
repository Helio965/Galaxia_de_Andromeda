import * as THREE from 'three';
import { createRandom } from '../random.js';

const vertexShader = /* glsl */ `
  attribute float aEnd;      // 0: head of the streak, 1: tail
  attribute float aShade;
  uniform vec3 uCamera;
  uniform vec3 uVelocity;    // units per second
  uniform float uSize;       // edge of the cube of particles around the camera
  uniform float uStreak;     // seconds of motion drawn by a streak
  uniform float uIntensity;
  varying float vAlpha;

  void main() {
    // Particles live in a cube that wraps around the camera: endless, and
    // always the same few thousand vertices.
    vec3 p = mod(position - uCamera, uSize) - 0.5 * uSize + uCamera;
    p -= uVelocity * uStreak * aEnd;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float distance = length(p - uCamera);
    // Fade near the camera and towards the edge of the cube (no popping when wrapping).
    float fade = smoothstep(0.02, 0.12, distance / uSize) * (1.0 - smoothstep(0.3, 0.5, distance / uSize));
    vAlpha = uIntensity * fade * aShade * (1.0 - 0.85 * aEnd);
  }
`;

const fragmentShader = /* glsl */ `
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(vec3(0.62, 0.74, 1.0) * vAlpha, 1.0);
  }
`;

/**
 * Sense of speed during fast flights: faint particles of "intergalactic
 * dust" (a visual cue, not a physical medium) drawn as short streaks along
 * the motion. Two layers: a fine one for slow flights inside a galaxy and a
 * coarse one for the long trips between galaxies. Invisible when the camera
 * moves slowly. Discreet on purpose: no tunnel, no warp effect.
 */
export function createSpaceDust({ count = 900, seed = 1 } = {}) {
  const group = new THREE.Group();
  group.name = 'SpaceDust';
  const random = createRandom(seed, 21);
  const layers = [
    { size: 6, minSpeed: 0.6, maxSpeed: 6 },
    { size: 140, minSpeed: 12, maxSpeed: 160 },
  ].map(({ size, minSpeed, maxSpeed }) => {
    const positions = new Float32Array(count * 2 * 3);
    const ends = new Float32Array(count * 2);
    const shades = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = random() * size;
      const y = random() * size;
      const z = random() * size;
      const shade = 0.35 + 0.65 * random();
      for (let k = 0; k < 2; k++) {
        positions.set([x, y, z], (i * 2 + k) * 3);
        ends[i * 2 + k] = k;
        shades[i * 2 + k] = shade;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    geometry.setAttribute('aShade', new THREE.BufferAttribute(shades, 1));
    const uniforms = {
      uCamera: { value: new THREE.Vector3() },
      uVelocity: { value: new THREE.Vector3() },
      uSize: { value: size },
      uStreak: { value: 0.05 },
      uIntensity: { value: 0 },
    };
    const lines = new THREE.LineSegments(
      geometry,
      new THREE.ShaderMaterial({
        name: 'SpaceDust',
        uniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    lines.frustumCulled = false;
    group.add(lines);
    return { lines, uniforms, size, minSpeed, maxSpeed };
  });

  let level = 1;
  return {
    group,
    /** 0 hides the effect, 1 is the default. */
    setLevel(value) {
      level = value;
    },
    /**
     * @param {THREE.Vector3} cameraPosition
     * @param {THREE.Vector3} velocity units per second
     */
    update(cameraPosition, velocity) {
      const speed = velocity.length();
      for (const layer of layers) {
        const u = layer.uniforms;
        u.uCamera.value.copy(cameraPosition);
        u.uVelocity.value.copy(velocity);
        // Streaks a fraction of the cube long, whatever the speed.
        u.uStreak.value = speed > 1e-4 ? Math.min(0.06, (layer.size * 0.04) / speed) : 0;
        const visible = THREE.MathUtils.smoothstep(speed, layer.minSpeed, layer.minSpeed * 3) *
          (1 - 0.6 * THREE.MathUtils.smoothstep(speed, layer.maxSpeed, layer.maxSpeed * 3));
        u.uIntensity.value = 0.35 * visible * level;
        layer.lines.visible = u.uIntensity.value > 1e-3;
      }
    },
    dispose() {
      for (const layer of layers) {
        layer.lines.geometry.dispose();
        layer.lines.material.dispose();
      }
    },
  };
}

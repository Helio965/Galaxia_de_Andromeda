import * as THREE from 'three';
import { galaxyStarVertex, starFragment, highlightFragment, nebulaFragment } from './shaders/stars.glsl.js';
import { SPIN } from './config.js';

const FRAGMENTS = { star: starFragment, highlight: highlightFragment, nebula: nebulaFragment };

/**
 * Packs the per-star data of one population into typed arrays.
 * `position` is xyz (or the orbit, see stars.glsl.js), `aStar` is
 * size / brightness / temperature / seed.
 */
export function createStarBuffers(count) {
  const position = new Float32Array(count * 3);
  const star = new Float32Array(count * 4);
  return {
    count,
    position,
    star,
    set(i, x, y, z, size, brightness, temperature, seed) {
      position[i * 3] = x;
      position[i * 3 + 1] = y;
      position[i * 3 + 2] = z;
      star[i * 4] = size;
      star[i * 4 + 1] = brightness;
      star[i * 4 + 2] = temperature;
      star[i * 4 + 3] = seed;
    },
  };
}

/**
 * One population of stars = one BufferGeometry + one THREE.Points, whatever the
 * number of stars (a single draw call). Stars are generated in random order, so
 * drawing only the first N of them is an unbiased thinner sample: that is how
 * the density slider and the adaptive quality work, without reallocating.
 *
 * @param {object} options
 * @param {'ellipse'|'pattern'|'differential'|null} options.motion see stars.glsl.js
 * @param {'star'|'highlight'|'nebula'} options.kind fragment shader
 */
export function createStarPopulation({
  name,
  buffers,
  sharedUniforms,
  motion = null,
  kind = 'star',
  brightness = 1,
  motionScale = 1,
  spriteScale = 1,
  compensation = 0.5,
}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(buffers.position, 3));
  geometry.setAttribute('aStar', new THREE.BufferAttribute(buffers.star, 4));
  // Positions only exist on the GPU: give three.js a sphere that always passes culling.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

  const uniforms = {
    ...sharedUniforms, // shared by reference: one update reaches every population
    uBrightness: { value: brightness },
    uMotionScale: { value: motionScale },
    uSpriteScale: { value: spriteScale },
  };

  const defines = { SPIN: SPIN.toFixed(1) };
  if (motion) defines[`MOTION_${motion.toUpperCase()}`] = '';
  if (kind === 'highlight') defines.HIGHLIGHT = '';
  if (kind === 'nebula') defines.NEBULA = '';

  const material = new THREE.ShaderMaterial({
    name: `${name}Material`,
    uniforms,
    defines,
    vertexShader: galaxyStarVertex,
    fragmentShader: FRAGMENTS[kind],
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.name = name;
  points.frustumCulled = false;

  let baseBrightness = brightness;
  let fraction = 1;

  function refresh() {
    // Fewer stars -> each one a bit brighter, so the galaxy keeps its glow.
    uniforms.uBrightness.value = baseBrightness * Math.pow(1 / fraction, compensation);
  }

  return {
    points,
    uniforms,
    count: buffers.count,
    get visibleCount() {
      return geometry.drawRange.count === Infinity ? buffers.count : geometry.drawRange.count;
    },
    /** Draws only the first fraction (0..1] of the stars. */
    setFraction(value) {
      fraction = THREE.MathUtils.clamp(value, 0.01, 1);
      geometry.setDrawRange(0, Math.max(1, Math.round(buffers.count * fraction)));
      refresh();
    },
    setBrightness(value) {
      baseBrightness = value;
      refresh();
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

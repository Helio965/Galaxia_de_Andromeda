import * as THREE from 'three';
import { createRandom, hernquistRadius, luminosity, randomDirection, shuffledIndices } from '../random.js';
import { createStarBuffers, createStarPopulation } from './starPoints.js';
import { satelliteVertex, satelliteFragment } from '../shaders/satellite.glsl.js';
import { STEP_MASK } from '../work.js';

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/**
 * Small companion ellipticals that live inside a galaxy's frame: M32 and M110
 * (NGC 205) next to M31. Small, warm and discreet: they add context without
 * stealing the focus.
 *
 * Their diffuse glow (two Gaussian ellipsoids integrated along each pixel's
 * ray) exists for the whole life of the galaxy, so they are visible from afar;
 * their stars are generated with the rest of the galaxy when the camera gets
 * close (see galaxyBody.js).
 *
 * A satellite spec: name, center, rotation, axes, scale/max (Hernquist radius of
 * the stars), share of the stars, starBrightness, core/envelope (sigma, surface,
 * colour), temperature range.
 */
export function createSatelliteGlows({ specs, sharedUniforms }) {
  const group = new THREE.Group();
  group.name = 'Satellites';
  const glows = specs.map((spec) => createGlow(spec, frameOf(spec), sharedUniforms));
  for (const glow of glows) group.add(glow.mesh);

  const cameraLocal = new THREE.Vector3();
  return {
    group,
    setIntensity(value) {
      for (const glow of glows) glow.uniforms.uIntensity.value = value;
    },
    /** @param {THREE.Vector3} cameraGalaxy camera position in the galaxy frame */
    update(cameraGalaxy) {
      for (const glow of glows) {
        glow.uniforms.uCamera.value.copy(glow.inverse.apply(cameraGalaxy, cameraLocal));
      }
    },
    dispose() {
      for (const glow of glows) {
        glow.mesh.geometry.dispose();
        glow.mesh.material.dispose();
      }
    },
  };
}

/** Stars of every satellite in one population (one draw call). */
export async function buildSatelliteStars({ count, specs, seed, name, sharedUniforms, brightness, work }) {
  const random = createRandom(seed, 5);
  const buffers = createStarBuffers(count);
  const order = shuffledIndices(count, random);
  const dir = { x: 0, y: 0, z: 0 };
  const local = new THREE.Vector3();
  let n = 0;

  for (let index = 0; index < specs.length; index++) {
    const spec = specs[index];
    const frame = frameOf(spec);
    const members = index === specs.length - 1 ? count - n : Math.round(count * spec.share);
    for (let k = 0; k < members; k++, n++) {
      if ((n & STEP_MASK) === 0) await work.step();
      const r = hernquistRadius(random, spec.scale, spec.max);
      randomDirection(random, dir);
      local.set(dir.x * r * spec.axes[0], dir.y * r * spec.axes[1], dir.z * r * spec.axes[2]);
      local.applyMatrix4(frame.matrix);
      const bright = luminosity(random, 3);
      const [t0, t1] = spec.temperature;
      buffers.set(
        order[n],
        local.x,
        local.y,
        local.z,
        1.2 + 0.8 * random() + 0.5 * bright,
        bright * spec.starBrightness,
        t0 + (t1 - t0) * random(),
        random(),
      );
    }
  }

  return createStarPopulation({
    name: `${name}SatelliteStars`,
    buffers,
    sharedUniforms,
    brightness,
  });
}

function frameOf(spec) {
  const frame = new THREE.Object3D();
  frame.position.fromArray(spec.center);
  frame.rotation.fromArray(spec.rotation);
  frame.updateMatrix();
  return frame;
}

function createGlow(spec, frame, sharedUniforms) {
  const axes = new THREE.Vector3().fromArray(spec.axes);
  const component = ({ sigma, surface }) => {
    const s = axes.clone().multiplyScalar(sigma);
    // Peak emissivity for the requested surface brightness seen along the short axis.
    const emissivity = surface / (Math.min(s.x, s.y, s.z) * SQRT_2PI);
    return new THREE.Vector4(1 / s.x, 1 / s.y, 1 / s.z, emissivity);
  };

  const uniforms = {
    ...sharedUniforms,
    uCenter: { value: new THREE.Vector3().fromArray(spec.center) },
    uCamera: { value: new THREE.Vector3() },
    uCore: { value: component(spec.core) },
    uEnvelope: { value: component(spec.envelope) },
    uCoreColor: { value: new THREE.Color().fromArray(spec.core.color) },
    uEnvelopeColor: { value: new THREE.Color().fromArray(spec.envelope.color) },
    uIntensity: { value: 1 },
  };

  // The box must contain ~4σ of the envelope.
  const half = axes.clone().multiplyScalar(spec.envelope.sigma * 4.2);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2),
    new THREE.ShaderMaterial({
      name: `${spec.name}Glow`,
      uniforms,
      vertexShader: satelliteVertex,
      fragmentShader: satelliteFragment,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  mesh.name = `${spec.name}Glow`;
  mesh.position.copy(frame.position);
  mesh.rotation.copy(frame.rotation);
  mesh.frustumCulled = false;

  const inverseMatrix = new THREE.Matrix4().copy(frame.matrix).invert();
  return {
    mesh,
    uniforms,
    inverse: {
      apply(point, target) {
        return target.copy(point).applyMatrix4(inverseMatrix);
      },
    },
  };
}

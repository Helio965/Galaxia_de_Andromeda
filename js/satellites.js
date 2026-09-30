import * as THREE from 'three';
import { createRandom, hernquistRadius, luminosity, randomDirection, shuffledIndices } from './random.js';
import { createStarBuffers, createStarPopulation } from './starPoints.js';
import { satelliteVertex, satelliteFragment } from './shaders/satellite.glsl.js';

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/**
 * M32 and M110 (NGC 205), the two satellites seen next to M31 in the photos.
 * Positions are in the galaxy frame: M32 just outside the near side of the
 * disc, M110 further away above the far side. Small, warm and discreet: they
 * add context without stealing the focus.
 */
const SATELLITES = [
  {
    name: 'M32',
    center: [1.6, -2.4, 8.2],
    rotation: [0.3, 0.6, 0.15],
    axes: [1, 0.8, 0.86], // compact E2 elliptical
    scale: 0.22, // Hernquist scale radius of the stars (kpc)
    max: 1.8,
    share: 0.32, // share of the satellite stars
    starBrightness: 0.9, // compact and bright: a few resolved giants on top of the glow
    core: { sigma: 0.12, surface: 1.5, color: [1.0, 0.95, 0.88] },
    envelope: { sigma: 0.5, surface: 0.3, color: [1.0, 0.88, 0.72] },
    temperature: [0.2, 0.45],
  },
  {
    name: 'M110',
    center: [-2.8, 4.6, -6.2],
    rotation: [0.5, -0.4, 0.9],
    axes: [1, 0.5, 0.62], // elongated E5 / dwarf spheroidal
    scale: 0.65,
    max: 4.2,
    share: 0.68,
    starBrightness: 0.4, // diffuse: the glow dominates
    core: { sigma: 0.22, surface: 0.36, color: [1.0, 0.93, 0.84] },
    envelope: { sigma: 0.95, surface: 0.2, color: [0.96, 0.88, 0.76] },
    temperature: [0.22, 0.55],
  },
];

export function createSatellites({ count, seed, sharedUniforms, brightness }) {
  const random = createRandom(seed, 5);
  const group = new THREE.Group();
  group.name = 'Satellites';

  // --- Stars: one population for both satellites (one draw call) -----------------------
  const buffers = createStarBuffers(count);
  const order = shuffledIndices(count, random);
  const dir = { x: 0, y: 0, z: 0 };
  const local = new THREE.Vector3();
  let n = 0;

  const glows = SATELLITES.map((spec, index) => {
    const frame = new THREE.Object3D();
    frame.position.fromArray(spec.center);
    frame.rotation.fromArray(spec.rotation);
    frame.updateMatrix();

    const members = index === SATELLITES.length - 1 ? count - n : Math.round(count * spec.share);
    for (let k = 0; k < members; k++, n++) {
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

    return createGlow(spec, frame, sharedUniforms);
  });

  for (const glow of glows) group.add(glow.mesh);

  const stars = createStarPopulation({
    name: 'SatelliteStars',
    buffers,
    sharedUniforms,
    brightness,
  });
  group.add(stars.points);

  const cameraLocal = new THREE.Vector3();
  return {
    group,
    stars,
    setIntensity(value) {
      for (const glow of glows) glow.uniforms.uIntensity.value = value;
    },
    /** @param {THREE.Vector3} cameraGalaxy camera position in the galaxy frame */
    update(cameraGalaxy) {
      for (const glow of glows) {
        glow.uniforms.uCamera.value.copy(glow.inverse.apply(cameraGalaxy, cameraLocal));
      }
    },
  };
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

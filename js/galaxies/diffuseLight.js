import * as THREE from 'three';
import { volumeVertex, volumeFragment } from '../shaders/volume.glsl.js';
import { VOLUME_LAYER } from '../postprocessing.js';
import { mapParameters, hasDeformation, tidalForward } from './galaxyMap.js';

const SQRT_2PI = Math.sqrt(2 * Math.PI);
const MIN_STEPS = 6;

/**
 * The diffuse light of a galaxy: spheroid + disc + dust, integrated per pixel
 * along the camera ray (see shaders/volume.glsl.js). It is the continuous glow
 * of a galaxy photograph, built in 3D: it thickens, thins and changes as the
 * camera moves, and the dust lanes absorb what is behind them.
 *
 * It also is the far level of detail of every galaxy: drawn into a buffer at
 * its own resolution, a distant galaxy covers a few pixels and costs almost
 * nothing, yet keeps its true shape and colours.
 *
 * @param {number} maxSteps compile-time upper bound (the profile's value)
 */
export function createDiffuseLight({ spec, sharedUniforms, bulge, maxSteps, stepLength, mapSize }) {
  const disk = spec.disk;
  const light = spec.light;
  const radius = disk ? spec.light.diskRadius : 0;
  const youngSigma = disk ? disk.youngSigma : 0.1;
  const oldSigma = disk ? disk.oldSigma : 0.3;

  // Tidally deformed discs reach further than their radius: find how far.
  const mapParams = spec.map ? mapParameters(spec.map) : null;
  const deformed = Boolean(mapParams && hasDeformation(mapParams));
  let bound = radius;
  if (deformed) {
    const out = { x: 0, z: 0 };
    for (let i = 0; i < 64; i++) {
      const angle = (i / 64) * Math.PI * 2;
      tidalForward(mapParams, Math.cos(angle) * radius, Math.sin(angle) * radius, out);
      bound = Math.max(bound, Math.hypot(out.x, out.z));
    }
    bound = Math.min(bound, spec.mapRadius);
  }

  const uniforms = {
    ...sharedUniforms,
    uSteps: { value: maxSteps },
    uMinSteps: { value: Math.min(MIN_STEPS, maxSteps) },
    uStepLength: { value: stepLength },
    uDiskRadius: { value: radius },
    uBoundRadius: { value: bound },
    uDiskScale: { value: disk ? disk.scaleLength : 1 },
    uOldSigma: { value: oldSigma },
    uYoungSigma: { value: youngSigma },
    // Peak emissivities that give the configured face-on surface brightness.
    uDiskLight: { value: (light.disk ?? 0) / (oldSigma * SQRT_2PI) },
    uYoungLight: { value: (light.young ?? 0) / (youngSigma * SQRT_2PI) },
    uHiiLight: { value: (light.hii ?? 0) / (youngSigma * SQRT_2PI) },
    uCoreLight: { value: 1 },
    uPixelAngle: { value: 0.001 },
    uTexelSize: { value: (2 * spec.mapRadius) / mapSize },
    uBulgeShape: { value: bulge.map((c) => new THREE.Vector4(...c.invSigma, c.emissivity)) },
    uBulgeColor: { value: bulge.map((c) => new THREE.Color(...c.color)) },
    uBulgeOrient: { value: bulge.map((c) => new THREE.Vector2(c.angle, c.pattern)) },
    uOldInner: { value: new THREE.Color(...light.oldInner) },
    uOldOuter: { value: new THREE.Color(...light.oldOuter) },
    uOldRange: { value: new THREE.Vector2(...light.oldRange) },
    uYoungColor: { value: new THREE.Color(...light.youngColor) },
    uHiiColor: { value: new THREE.Color(...light.hiiColor) },
  };

  const defines = { BULGE_COMPONENTS: bulge.length, MAX_STEPS: maxSteps };
  if (spec.warp) defines.DISK_WARP = '';
  if (deformed) defines.TIDAL_DEFORM = '';

  const material = new THREE.ShaderMaterial({
    name: `${spec.name}DiffuseLight`,
    uniforms,
    defines,
    vertexShader: volumeVertex,
    fragmentShader: volumeFragment,
    side: THREE.BackSide, // back faces: also works with the camera inside the box
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });

  // The box contains the disc and ~3σ of the widest spheroid component.
  const halfWidth = Math.max(bound + 1, ...bulge.map((c) => c.extent));
  const halfHeight = Math.max(5, ...bulge.map((c) => c.height), 3.2 * oldSigma + (spec.warp ? Math.abs(spec.warp.amp) : 0));
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(halfWidth * 2, halfHeight * 2, halfWidth * 2), material);
  mesh.name = `${spec.name}DiffuseLight`;
  mesh.frustumCulled = false;
  mesh.layers.set(VOLUME_LAYER); // drawn by VolumePass, at its own resolution

  const base = {
    young: uniforms.uYoungLight.value,
    hii: uniforms.uHiiLight.value,
  };
  let detailSteps = maxSteps;

  return {
    mesh,
    uniforms,
    maxSteps,
    halfWidth,
    get steps() {
      return uniforms.uSteps.value;
    },
    /**
     * Samples per ray. `fraction` (0..1) comes from the level of detail: a far
     * galaxy covers few pixels and needs few samples. `scale` comes from the
     * adaptive quality (fewer samples everywhere).
     */
    setSteps(fraction, scale = 1) {
      detailSteps = Math.max(MIN_STEPS, Math.round(maxSteps * scale));
      const value = THREE.MathUtils.clamp(Math.round(MIN_STEPS + (detailSteps - MIN_STEPS) * fraction), 4, maxSteps);
      uniforms.uStepLength.value = stepLength * (maxSteps / value);
      uniforms.uSteps.value = value;
      uniforms.uMinSteps.value = Math.min(MIN_STEPS, value);
    },
    setMap(texture, size) {
      uniforms.uGalaxyMap.value = texture;
      uniforms.uTexelSize.value = (2 * spec.mapRadius) / size;
    },
    setCore(value) {
      uniforms.uCoreLight.value = value;
    },
    setArms(value) {
      uniforms.uYoungLight.value = base.young * value;
      uniforms.uHiiLight.value = base.hii * value;
    },
    /** @param {number} pixelAngle radians covered by one pixel of the volume buffer */
    setPixelAngle(pixelAngle) {
      uniforms.uPixelAngle.value = pixelAngle;
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}

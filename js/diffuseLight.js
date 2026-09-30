import * as THREE from 'three';
import { volumeVertex, volumeFragment } from './shaders/volume.glsl.js';
import { MODEL, LIGHT } from './config.js';
import { VOLUME_LAYER } from './postprocessing.js';

const SQRT_2PI = Math.sqrt(2 * Math.PI);
const BOX_HALF_HEIGHT = 5; // contains the bulge's light (its widest Gaussian, ×3σ)

/**
 * The diffuse light of M31: bulge + disc + dust, integrated per pixel along
 * the camera ray (see shaders/volume.glsl.js). It is the continuous glow of a
 * galaxy photograph, built in 3D: it thickens, thins and changes as the camera
 * moves, and the dust lanes absorb what is behind them.
 *
 * @param {number} maxSteps compile-time upper bound (the profile's value)
 */
export function createDiffuseLight({ sharedUniforms, bulge, maxSteps, stepLength, mapSize }) {
  const radius = MODEL.diskOuter + 1;

  const uniforms = {
    ...sharedUniforms,
    uSteps: { value: maxSteps },
    uMinSteps: { value: Math.min(6, maxSteps) },
    uStepLength: { value: stepLength },
    uDiskRadius: { value: radius },
    uDiskScale: { value: MODEL.diskScaleLength },
    uOldSigma: { value: MODEL.oldSigma },
    uYoungSigma: { value: MODEL.youngSigma },
    // Peak emissivities that give the configured face-on surface brightness.
    uDiskLight: { value: LIGHT.disk / (MODEL.oldSigma * SQRT_2PI) },
    uYoungLight: { value: LIGHT.young / (MODEL.youngSigma * SQRT_2PI) },
    uHiiLight: { value: LIGHT.hii / (MODEL.youngSigma * SQRT_2PI) },
    uCoreLight: { value: 1 },
    uPixelAngle: { value: 0.001 },
    uTexelSize: { value: (2 * MODEL.mapRadius) / mapSize },
    uBulgeShape: { value: bulge.map((c) => new THREE.Vector4(...c.invSigma, c.emissivity)) },
    uBulgeColor: { value: bulge.map((c) => new THREE.Color(...c.color)) },
  };

  const material = new THREE.ShaderMaterial({
    name: 'DiffuseLightMaterial',
    uniforms,
    defines: {
      BULGE_COMPONENTS: bulge.length,
      MAX_STEPS: maxSteps,
    },
    vertexShader: volumeVertex,
    fragmentShader: volumeFragment,
    side: THREE.BackSide, // back faces: also works with the camera inside the box
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(radius * 2, BOX_HALF_HEIGHT * 2, radius * 2), material);
  mesh.name = 'DiffuseLight';
  mesh.frustumCulled = false;
  mesh.layers.set(VOLUME_LAYER); // drawn by VolumePass, at its own resolution

  const base = {
    young: uniforms.uYoungLight.value,
    hii: uniforms.uHiiLight.value,
    disk: uniforms.uDiskLight.value,
  };

  return {
    mesh,
    uniforms,
    maxSteps,
    get steps() {
      return uniforms.uSteps.value;
    },
    /** Fewer samples per ray: lower bound, upper bound and spacing all follow. */
    setSteps(steps) {
      const value = THREE.MathUtils.clamp(Math.round(steps), 4, maxSteps);
      uniforms.uStepLength.value = stepLength * (maxSteps / value);
      uniforms.uSteps.value = value;
      uniforms.uMinSteps.value = Math.min(uniforms.uMinSteps.value, value);
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

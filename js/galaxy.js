import * as THREE from 'three';
import { createGalaxyMap } from './galaxyMap.js';
import { createGalacticCore } from './galacticCore.js';
import { createStellarDisk } from './stellarDisk.js';
import { createSpiralArms } from './spiralArms.js';
import { createHalo } from './halo.js';
import { createSatellites } from './satellites.js';
import { createDiffuseLight } from './diffuseLight.js';
import { createDustUniforms, setDustLevel } from './dustLanes.js';
import { MODEL, SPIN, PATTERN_SPEED, CURVE_V } from './config.js';

// Brightness of one star of each population (HDR units, before perspective).
const STAR_BRIGHTNESS = {
  bulge: 0.55,
  disk: 0.5,
  arms: 0.75,
  highlights: 1.5,
  nebulae: 0.12,
  halo: 0.5,
  satellites: 0.2,
};

/**
 * Assembles M31: the procedural map, the star populations, the diffuse light
 * and the satellites, all inside one group (the galaxy frame). Every shader
 * shares the same uniform objects, so updating the clock, the camera or the
 * dust once per frame reaches all of them.
 */
export async function createGalaxy({ renderer, quality, seed }) {
  const group = new THREE.Group();
  group.name = 'M31';
  group.rotation.order = 'ZXY'; // roll in the picture, then inclination

  const map = await createGalaxyMap(renderer, { size: quality.mapSize, seed });

  const shared = {
    uTime: { value: 0 },
    uPatternAngle: { value: 0 },
    uPatternSpeed: { value: PATTERN_SPEED },
    uCurveV: { value: CURVE_V },
    uCurveR: { value: MODEL.curveRadius },
    uTanPitch: { value: MODEL.tanPitch },
    uEllipseOffset: { value: MODEL.ellipseOffset },
    uEccentricity: { value: MODEL.eccentricity },
    uGalaxyMap: { value: map.texture },
    uMapRadius: { value: MODEL.mapRadius },
    uCamLocal: { value: new THREE.Vector3() },
    uSizeScale: { value: 1 },
    uRefDepth: { value: 40 },
    uMinSize: { value: 1.2 },
    uMaxSize: { value: 48 },
    ...createDustUniforms(),
  };

  const core = createGalacticCore({ count: quality.bulge, seed, sharedUniforms: shared, brightness: STAR_BRIGHTNESS.bulge });
  const disk = createStellarDisk({ count: quality.disk, seed, sharedUniforms: shared, brightness: STAR_BRIGHTNESS.disk });
  const arms = createSpiralArms({
    counts: quality,
    seed,
    sampler: map.sampler,
    sharedUniforms: shared,
    brightness: STAR_BRIGHTNESS,
  });
  const halo = createHalo({
    count: quality.halo,
    globulars: quality.globulars,
    seed,
    sharedUniforms: shared,
    brightness: STAR_BRIGHTNESS.halo,
  });
  const satellites = createSatellites({
    count: quality.satellites,
    seed,
    sharedUniforms: shared,
    brightness: STAR_BRIGHTNESS.satellites,
  });
  const light = createDiffuseLight({
    sharedUniforms: shared,
    bulge: core.lightComponents,
    maxSteps: quality.volumeSteps,
    stepLength: quality.volumeStepLength,
    mapSize: quality.mapSize,
  });

  group.add(light.mesh);
  group.add(satellites.group);
  const populations = {
    bulge: core.stars,
    disk,
    arms: arms.stars,
    highlights: arms.highlights,
    nebulae: arms.nebulae,
    halo,
    satellites: satellites.stars,
  };
  for (const population of Object.values(populations)) {
    if (population.points.parent !== satellites.group) group.add(population.points);
  }
  const countable = Object.entries(populations)
    .filter(([key]) => key !== 'nebulae')
    .map(([, population]) => population);

  // Settings that scale the brightness of several populations at once.
  const levels = { core: 1, arms: 1 };
  function applyBrightness() {
    populations.bulge.setBrightness(STAR_BRIGHTNESS.bulge * levels.core);
    populations.arms.setBrightness(STAR_BRIGHTNESS.arms * levels.arms);
    populations.highlights.setBrightness(STAR_BRIGHTNESS.highlights * (0.35 + 0.65 * levels.arms));
    populations.nebulae.setBrightness(STAR_BRIGHTNESS.nebulae * levels.arms);
  }

  const cameraLocal = new THREE.Vector3();

  return {
    group,
    light,
    get starCount() {
      return countable.reduce((sum, population) => sum + population.visibleCount, 0);
    },
    get maxStarCount() {
      return countable.reduce((sum, population) => sum + population.count, 0);
    },
    /** Fraction (0..1] of every star population to draw. */
    setDensity(fraction) {
      for (const population of Object.values(populations)) population.setFraction(fraction);
    },
    setCore(value) {
      levels.core = value;
      light.setCore(value);
      satellites.setIntensity(0.6 + 0.4 * value);
      applyBrightness();
    },
    setArms(value) {
      levels.arms = value;
      light.setArms(value);
      applyBrightness();
    },
    setDust(value) {
      setDustLevel(shared, value);
    },
    /** Orientation: roll in the picture, then inclination towards the camera. */
    setOrientation(roll, tilt) {
      group.rotation.set(tilt, 0, roll);
    },
    /**
     * @param {number} heightPixels drawing buffer height (device pixels)
     * @param {number} volumeHeight height of the diffuse light buffer (pixels)
     * @param {number} fov vertical field of view (degrees)
     */
    setViewport(heightPixels, volumeHeight, fov) {
      shared.uSizeScale.value = heightPixels / 1080;
      light.setPixelAngle((2 * Math.tan(THREE.MathUtils.degToRad(fov / 2))) / volumeHeight);
    },
    /**
     * @param {number} time galaxy clock (seconds × speed)
     * @param {THREE.Camera} camera
     * @param {number} homeDistance distance at which stars have their nominal size
     */
    update(time, camera, homeDistance) {
      shared.uTime.value = time;
      // Wrapped so the angle keeps its precision however long the page runs.
      shared.uPatternAngle.value = SPIN * ((PATTERN_SPEED * time) % (2 * Math.PI));
      shared.uRefDepth.value = homeDistance;
      group.updateMatrixWorld();
      cameraLocal.copy(camera.position);
      group.worldToLocal(cameraLocal);
      shared.uCamLocal.value.copy(cameraLocal);
      satellites.update(cameraLocal);
    },
  };
}

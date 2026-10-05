import * as THREE from 'three';
import { createMapRenderer, createEmptyMap, mapParameters, hasDeformation } from './galaxyMap.js';
import { buildGalacticCore, bulgeLightComponents } from './galacticCore.js';
import { buildStellarDisk } from './stellarDisk.js';
import { buildSpiralArms } from './spiralArms.js';
import { buildBar } from './bar.js';
import { buildShells } from './shells.js';
import { buildHalo } from './halo.js';
import { createSatelliteGlows, buildSatelliteStars } from './satellites.js';
import { createDiffuseLight } from './diffuseLight.js';
import { createDustUniforms, setDustLevel } from './dustLanes.js';
import { SPIN, rotationParameters } from '../config.js';
import { discOrientation } from '../universe/specTools.js';

const SMALL_MAP = 512; // map kept for the whole life of the galaxy (far views)
let emptyMap = null;

/**
 * Uniforms shared by every shader of a galaxy (and by the tidal streams of a
 * system): clock, rotation, map, camera, sizes, fade, warp and dust.
 */
export function createSharedUniforms(spec, maxPointSize) {
  const rotation = rotationParameters(spec.rotation);
  const warp = spec.warp;
  emptyMap ??= createEmptyMap();
  return {
    uTime: { value: 0 },
    uPatternAngle: { value: 0 },
    uPatternSpeed: { value: rotation.patternSpeed },
    uCurveV: { value: rotation.curveV },
    uCurveR: { value: rotation.curveRadius },
    uTanPitch: { value: spec.orbits.tanPitch },
    uEllipseOffset: { value: spec.orbits.ellipseOffset },
    uEccentricity: { value: spec.orbits.eccentricity },
    uEccWindow: { value: new THREE.Vector4(...spec.orbits.eccWindow) },
    uGalaxyMap: { value: emptyMap },
    uMapRadius: { value: spec.mapRadius },
    uCamLocal: { value: new THREE.Vector3() },
    uSizeScale: { value: 1 },
    uProjScale: { value: 1000 },
    uRefDepth: { value: 40 },
    uMinSize: { value: 1.2 },
    uMaxSize: { value: maxPointSize },
    uFade: { value: 0 },
    uDiskWarp: { value: new THREE.Vector4(warp?.amp ?? 0, warp?.r0 ?? 0, warp?.r1 ?? 1, warp?.angle ?? 0) },
    ...createDustUniforms(spec),
  };
}

/**
 * One galaxy body: an M31, a Sombrero, an elliptical, or one member of an
 * interacting pair. Built from its catalog spec, in two stages:
 *
 *  - prepare(): the procedural map (small) and the diffuse light volume.
 *    That alone draws the whole galaxy, shape and colours, from any distance,
 *    for a few pixels' worth of work. Done once for every galaxy at startup.
 *  - load(): the stars (hundreds of thousands, generated in time slices so the
 *    animation never stops) and a sharp map. Done when the camera gets close,
 *    undone (unload) when it leaves.
 *
 * Every shader of the body shares the same uniform objects, so updating the
 * clock, the camera or the dust once per frame reaches all of them.
 */
export function createGalaxyBody({ renderer, spec, quality, maxPointSize }) {
  const group = new THREE.Group();
  group.name = spec.name;
  if (spec.frame) {
    group.position.fromArray(spec.frame.position ?? [0, 0, 0]);
    group.quaternion.copy(discOrientation(spec.frame.orientation));
  }

  const rotation = rotationParameters(spec.rotation);
  const mapParams = spec.map ? mapParameters(spec.map) : null;
  if (mapParams && hasDeformation(mapParams)) {
    // The map carries the old disc's profile (see map.glsl.js).
    mapParams.oldDisk = [spec.disk.scaleLength, spec.light.diskRadius, 1, 0];
  }
  const shared = createSharedUniforms(spec, maxPointSize);

  const bulge = bulgeLightComponents(spec);
  const light = createDiffuseLight({
    spec,
    sharedUniforms: shared,
    bulge,
    maxSteps: quality.volumeSteps,
    stepLength: quality.volumeStepLength,
    mapSize: SMALL_MAP,
  });
  group.add(light.mesh);

  const satelliteGlows = spec.satellites ? createSatelliteGlows({ specs: spec.satellites, sharedUniforms: shared }) : null;
  if (satelliteGlows) group.add(satelliteGlows.group);

  // Smaller galaxies get fewer stars over a smaller area: keep the balance
  // between the grain of the stars and the diffuse light like in M31.
  const starDensity = THREE.MathUtils.clamp(Math.sqrt((spec.scale ?? 1) ** 2 / (spec.starWeight ?? 1)), 0.6, 1.4);
  const brightness = Object.fromEntries(Object.entries(spec.stars.brightness).map(([key, value]) => [key, value * starDensity]));
  const levels = { core: 1, arms: 1 };
  let mapRenderer = null;
  let smallMap = null;
  let sharpMap = null;
  let sampler = null;
  let populations = null;
  let fraction = 1;
  const cameraLocal = new THREE.Vector3();

  function applyBrightness() {
    if (!populations) return;
    const p = populations;
    p.bulge?.setBrightness(brightness.bulge * levels.core);
    p.bar?.setBrightness(brightness.bar * levels.core);
    p.arms?.setBrightness(brightness.arms * levels.arms);
    p.highlights?.setBrightness(brightness.highlights * (0.35 + 0.65 * levels.arms));
    p.nebulae?.setBrightness(brightness.nebulae * levels.arms);
  }

  function countable() {
    return populations
      ? Object.entries(populations)
          .filter(([key]) => key !== 'nebulae' && key !== 'shellGlow')
          .map(([, population]) => population)
      : [];
  }

  const body = {
    spec,
    group,
    light,
    shared,
    get loaded() {
      return populations !== null;
    },

    /** Small map + its CPU copy (star placement). Cheap: done for every galaxy at startup. */
    async prepare() {
      if (!mapParams) return;
      mapRenderer = createMapRenderer(renderer, { params: mapParams, seed: spec.seed, radius: spec.mapRadius });
      smallMap = mapRenderer.render(SMALL_MAP);
      light.setMap(smallMap.texture, SMALL_MAP);
      sampler = await mapRenderer.readSampler();
    },

    /**
     * Generates the stars (time-sliced by `work`) and a sharp map.
     * @param {number} budget stars of the whole body at full detail
     */
    async load(budget, work, isCancelled = () => false) {
      const shares = spec.stars.shares;
      const count = (key) => Math.max(0, Math.round(budget * (shares[key] ?? 0)));
      const differential = spec.static ? null : 'differential';
      const built = {};

      if (count('bulge') > 0) {
        built.bulge = await buildGalacticCore({
          count: count('bulge'),
          spec,
          sharedUniforms: shared,
          brightness: brightness.bulge,
          work,
          motion: differential,
        });
      }
      if (spec.disk && count('disk') > 0) {
        built.disk = await buildStellarDisk({ count: count('disk'), spec, sharedUniforms: shared, brightness: brightness.disk, work, mapParams });
      }
      if (spec.disk && sampler && count('arms') > 0) {
        const arms = await buildSpiralArms({
          counts: { arms: count('arms'), highlights: count('highlights'), nebulae: count('nebulae') },
          spec,
          sampler,
          sharedUniforms: shared,
          brightness,
          work,
        });
        built.arms = arms.stars;
        built.highlights = arms.highlights;
        built.nebulae = arms.nebulae;
      }
      if (spec.stars.bar && count('bar') > 0) {
        built.bar = await buildBar({ count: count('bar'), spec, sharedUniforms: shared, brightness: brightness.bar, work });
      }
      if (count('halo') > 0) {
        built.halo = await buildHalo({
          count: count('halo'),
          globulars: Math.round(count('halo') / 100),
          spec,
          sharedUniforms: shared,
          brightness: brightness.halo,
          work,
          motion: differential,
        });
      }
      if (spec.stars.shells && count('shells') > 0) {
        const shells = await buildShells({
          count: count('shells'),
          glowCount: count('shellGlow'),
          spec,
          sharedUniforms: shared,
          brightness,
          work,
        });
        built.shells = shells.stars;
        built.shellGlow = shells.glow;
      }
      if (spec.satellites && count('satellites') > 0) {
        built.satellites = await buildSatelliteStars({
          count: count('satellites'),
          specs: spec.satellites,
          seed: spec.seed,
          name: spec.name,
          sharedUniforms: shared,
          brightness: brightness.satellites,
          work,
        });
      }

      // The camera left (or the page asked for something else) while the
      // stars were being generated: throw them away.
      if (isCancelled()) {
        for (const population of Object.values(built)) population.dispose();
        return false;
      }

      populations = built;
      for (const population of Object.values(built)) group.add(population.points);
      applyBrightness();
      body.setFraction(fraction);

      // A sharp map while the camera is close.
      if (mapRenderer) {
        sharpMap = mapRenderer.render(quality.mapSize);
        light.setMap(sharpMap.texture, quality.mapSize);
      }
      return true;
    },

    unload() {
      if (populations) {
        for (const population of Object.values(populations)) {
          group.remove(population.points);
          population.dispose();
        }
        populations = null;
      }
      if (sharpMap) {
        light.setMap(smallMap.texture, SMALL_MAP);
        sharpMap.dispose();
        sharpMap = null;
      }
    },

    get starCount() {
      return countable().reduce((sum, population) => sum + population.visibleCount, 0);
    },
    get maxStarCount() {
      return countable().reduce((sum, population) => sum + population.count, 0);
    },

    /** Fraction (0..1] of every star population to draw. */
    setFraction(value) {
      fraction = value;
      if (!populations) return;
      for (const population of Object.values(populations)) population.setFraction(value);
    },
    setFade(value) {
      shared.uFade.value = value;
    },
    setCore(value) {
      levels.core = value;
      light.setCore(value * (spec.light.coreGain ?? 1));
      satelliteGlows?.setIntensity(0.6 + 0.4 * value);
      applyBrightness();
    },
    setArms(value) {
      levels.arms = value;
      light.setArms(value);
      applyBrightness();
    },
    setDust(value) {
      setDustLevel(shared, spec, value);
    },
    /**
     * @param {number} heightPixels drawing buffer height (device pixels)
     * @param {number} volumeHeight height of the diffuse light buffer (pixels)
     * @param {number} fov vertical field of view (degrees)
     */
    setViewport(heightPixels, volumeHeight, fov) {
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(fov / 2));
      shared.uSizeScale.value = heightPixels / 1080;
      shared.uProjScale.value = heightPixels / (2 * tanHalf);
      light.setPixelAngle((2 * tanHalf) / volumeHeight);
    },
    /**
     * @param {number} time galaxy clock (seconds × speed)
     * @param {THREE.Vector3} cameraWorld
     * @param {number} refDepth depth at which stars have their nominal size
     */
    update(time, cameraWorld, refDepth) {
      // Interacting galaxies are frozen in a representative instant.
      const t = spec.static ? 0 : time;
      shared.uTime.value = t;
      // Wrapped so the angle keeps its precision however long the page runs.
      shared.uPatternAngle.value = SPIN * ((rotation.patternSpeed * t) % (2 * Math.PI));
      shared.uRefDepth.value = refDepth;
      cameraLocal.copy(cameraWorld);
      group.worldToLocal(cameraLocal);
      shared.uCamLocal.value.copy(cameraLocal);
      satelliteGlows?.update(cameraLocal);
    },
    dispose() {
      body.unload();
      light.dispose();
      satelliteGlows?.dispose();
      smallMap?.dispose();
      mapRenderer?.dispose();
    },
  };

  body.setCore(1);
  return body;
}

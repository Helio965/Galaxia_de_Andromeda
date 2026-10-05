import * as THREE from 'three';
import { createGalaxyBody, createSharedUniforms } from './galaxyBody.js';
import { buildTidalStreams } from './tidal.js';
import { pictureFrame } from '../universe/specTools.js';
import { scenePosition } from '../universe/galaxyCatalog.js';

// Tidal streams have no disc, no map and no rotation: a neutral spec for their uniforms.
const STREAM_SPEC = {
  rotation: { patternPeriod: 600, corotation: 12, curveRadius: 1.4 },
  orbits: { tanPitch: 0.2, ellipseOffset: 0, eccentricity: 0, eccWindow: [1, 2, 3, 4] },
  mapRadius: 1,
  light: { dust: 0 },
  disk: null,
};

/**
 * One entry of the catalog in the scene: a single galaxy (M31 with its
 * satellites, the Sombrero...) or an interacting system (the two Antennae
 * and their tidal tails). Placed at its compressed position, turned so that
 * from the starting point it looks like its photograph.
 *
 * The diffuse light of every body exists from the start (cheap, visible from
 * anywhere). The stars are generated on demand by load() — called by the
 * level-of-detail manager when the camera approaches — and released by unload().
 */
export function createGalaxySystem({ renderer, entry, quality, maxPointSize }) {
  const group = new THREE.Group();
  group.name = entry.id;
  const center = new THREE.Vector3().fromArray(scenePosition(entry));
  group.position.copy(center);
  // Seen from the starting point: the observer is towards the origin.
  const viewDirection = center.clone().negate().normalize();
  group.quaternion.copy(pictureFrame(viewDirection.toArray(), entry.view?.roll ?? 0));

  const bodies = entry.bodies.map((spec) => createGalaxyBody({ renderer, spec, quality, maxPointSize }));
  for (const body of bodies) group.add(body.group);
  // Nothing in a system moves: its matrices are computed once (worldToLocal needs them now).
  group.updateMatrixWorld(true);

  const streamShared = entry.tidal ? createSharedUniforms(STREAM_SPEC, maxPointSize) : null;
  let streams = null; // { stars, glow } once loaded
  let loadToken = 0;
  let loading = false;
  let pending = null;
  let fraction = 1;
  let fade = 0;
  const cameraLocal = new THREE.Vector3();

  /** Generates every population, one after the other; false if cancelled. */
  async function generate(profileStars, work) {
    loading = true;
    const token = ++loadToken;
    const cancelled = () => token !== loadToken;
    try {
      for (const body of bodies) {
        if (body.loaded) continue;
        work.reset();
        const done = await body.load(Math.round(profileStars * body.spec.starWeight), work, cancelled);
        if (!done || cancelled()) return false;
        body.setFraction(fraction);
        body.setFade(fade);
      }
      if (entry.tidal && !streams) {
        const tidal = entry.tidal;
        const count = Math.round(profileStars * tidal.starWeight);
        work.reset();
        const built = await buildTidalStreams({
          count,
          glowCount: Math.round(count * tidal.glowShare),
          streams: tidal.streams,
          seed: entry.seed,
          name: entry.id,
          sharedUniforms: streamShared,
          brightness: tidal.brightness,
          work,
        });
        if (cancelled()) {
          built.stars.dispose();
          built.glow.dispose();
          return false;
        }
        streams = built;
        group.add(streams.stars.points, streams.glow.points);
        streams.stars.setFraction(fraction);
        streams.glow.setFraction(fraction);
      }
      return true;
    } finally {
      if (token === loadToken) loading = false;
    }
  }

  const system = {
    entry,
    id: entry.id,
    group,
    bodies,
    center,
    radius: entry.radius,
    /** Unit vector from the system towards the observer of its photograph. */
    viewDirection,
    /** Level of detail (managed by lodManager.js). */
    level: 4,

    get loaded() {
      return bodies.every((body) => body.loaded) && (!entry.tidal || streams !== null);
    },
    get loading() {
      return loading;
    },

    /** Small procedural maps: done for every system at startup. */
    async prepare() {
      for (const body of bodies) await body.prepare();
    },

    /**
     * Generates the stars of every body (time-sliced by `work`).
     * @param {number} profileStars star budget of the quality profile for a galaxy of weight 1
     * @returns {Promise<boolean>} false if cancelled by unload()
     */
    load(profileStars, work) {
      if (system.loaded) return Promise.resolve(true);
      // Already being generated: the caller waits for the same job.
      if (!pending) {
        const job = generate(profileStars, work).finally(() => {
          if (pending === job) pending = null;
        });
        pending = job;
      }
      return pending;
    },

    /** Releases the stars (the diffuse light stays). Cancels a load in progress. */
    unload() {
      loadToken++;
      loading = false;
      pending = null;
      for (const body of bodies) body.unload();
      if (streams) {
        group.remove(streams.stars.points, streams.glow.points);
        streams.stars.dispose();
        streams.glow.dispose();
        streams = null;
      }
    },

    get starCount() {
      return bodies.reduce((sum, body) => sum + body.starCount, 0) + (streams ? streams.stars.visibleCount : 0);
    },
    get maxStarCount() {
      return bodies.reduce((sum, body) => sum + body.maxStarCount, 0) + (streams ? streams.stars.count : 0);
    },

    setFraction(value) {
      fraction = value;
      for (const body of bodies) body.setFraction(value);
      streams?.stars.setFraction(value);
      streams?.glow.setFraction(Math.max(value, 0.5));
    },
    /** Fade of the stars (0..1): crossfade between levels of detail. */
    setFade(value) {
      fade = value;
      for (const body of bodies) body.setFade(value);
      if (streamShared) streamShared.uFade.value = value;
    },
    get fade() {
      return fade;
    },
    /** Samples of the diffuse light per pixel (fraction from the LOD, scale from the adaptive quality). */
    setSteps(stepFraction, scale) {
      for (const body of bodies) body.light.setSteps(stepFraction, scale);
    },
    setCore(value) {
      for (const body of bodies) body.setCore(value);
    },
    setArms(value) {
      for (const body of bodies) body.setArms(value);
    },
    setDust(value) {
      for (const body of bodies) body.setDust(value);
    },
    setViewport(heightPixels, volumeHeight, fov) {
      for (const body of bodies) body.setViewport(heightPixels, volumeHeight, fov);
      if (streamShared) {
        const tanHalf = Math.tan(THREE.MathUtils.degToRad(fov / 2));
        streamShared.uSizeScale.value = heightPixels / 1080;
        streamShared.uProjScale.value = heightPixels / (2 * tanHalf);
      }
    },
    /** Distance from a point to the system's centre, in units of its radius. */
    relativeDistance(point) {
      return point.distanceTo(center) / system.radius;
    },
    update(time, cameraWorld, refDepth) {
      for (const body of bodies) body.update(time, cameraWorld, refDepth);
      if (streamShared) {
        streamShared.uRefDepth.value = refDepth;
        cameraLocal.copy(cameraWorld);
        group.worldToLocal(cameraLocal);
        streamShared.uCamLocal.value.copy(cameraLocal);
      }
    },
    dispose() {
      system.unload();
      for (const body of bodies) body.dispose();
    },
  };

  return system;
}

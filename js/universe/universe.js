import * as THREE from 'three';
import { GALAXY_CATALOG } from './galaxyCatalog.js';
import { createGalaxySystem } from '../galaxies/galaxySystem.js';

/**
 * The navigable universe: one galaxy system per catalog entry, all of them
 * present from the start as diffuse light (their stars come and go with the
 * level of detail, see lodManager.js).
 *
 * `seedOffset` (from ?seed=) changes every procedural seed at once: the same
 * galaxies, with different details.
 */
export function createUniverse({ renderer, quality, maxPointSize, seedOffset = 0 }) {
  const group = new THREE.Group();
  group.name = 'Universe';

  const systems = GALAXY_CATALOG.map((entry) => {
    if (seedOffset) {
      entry = {
        ...entry,
        seed: (entry.seed ^ seedOffset) >>> 0,
        bodies: entry.bodies.map((spec) => ({ ...spec, seed: (spec.seed ^ seedOffset) >>> 0 })),
      };
    }
    return createGalaxySystem({ renderer, entry, quality, maxPointSize });
  });
  for (const system of systems) group.add(system.group);
  const byId = new Map(systems.map((system) => [system.id, system]));

  const projected = new THREE.Vector3();

  return {
    group,
    systems,
    get(id) {
      return byId.get(String(id ?? '').toLowerCase());
    },

    /** Procedural maps of every galaxy. `onProgress(done, total)`. */
    async prepare(onProgress) {
      let done = 0;
      for (const system of systems) {
        await system.prepare();
        onProgress?.(++done, systems.length);
      }
    },

    /**
     * The system whose surface is nearest to `point`, with that distance
     * (distance to the centre minus a fraction of the radius, never negative).
     */
    nearest(point) {
      let best = null;
      let bestDistance = Infinity;
      for (const system of systems) {
        const distance = Math.max(0, point.distanceTo(system.center) - system.radius * 0.6);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = system;
        }
      }
      return { system: best, distance: bestDistance };
    },

    /**
     * The galaxy under a screen position (normalised device coordinates).
     * A galaxy is hit within its apparent core (or a few pixels around a
     * distant one); the nearest of overlapping galaxies wins.
     */
    pick(ndcX, ndcY, camera, viewportHeight) {
      const pixelsPerUnit = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      let best = null;
      let bestScore = Infinity;
      for (const system of systems) {
        projected.copy(system.center).project(camera);
        if (projected.z > 1 || projected.z < -1) continue; // behind the camera
        const distance = camera.position.distanceTo(system.center);
        const apparent = Math.max((system.radius * 0.55 * pixelsPerUnit) / distance, 18);
        const dx = ((projected.x - ndcX) * viewportHeight * camera.aspect) / 2;
        const dy = ((projected.y - ndcY) * viewportHeight) / 2;
        const offset = Math.hypot(dx, dy) / apparent;
        if (offset > 1) continue;
        const score = offset + distance * 1e-4;
        if (score < bestScore) {
          bestScore = score;
          best = system;
        }
      }
      return best;
    },

    setViewport(heightPixels, volumeHeight, fov) {
      for (const system of systems) system.setViewport(heightPixels, volumeHeight, fov);
    },
    setCore(value) {
      for (const system of systems) system.setCore(value);
    },
    setArms(value) {
      for (const system of systems) system.setArms(value);
    },
    setDust(value) {
      for (const system of systems) system.setDust(value);
    },
    /**
     * @param {(system) => number} refDepth depth at which a system's stars have
     *   their nominal size (its framing distance, corrected for the lens)
     */
    update(time, cameraWorld, refDepth) {
      for (const system of systems) system.update(time, cameraWorld, refDepth(system));
    },
    get starCount() {
      return systems.reduce((sum, system) => sum + system.starCount, 0);
    },
    get loadedSystems() {
      return systems.filter((system) => system.loaded);
    },
  };
}

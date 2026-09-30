import { createRandom, gaussian, luminosity, randomDirection, shuffledIndices } from './random.js';
import { createStarBuffers, createStarPopulation } from './starPoints.js';
import { MODEL } from './config.js';

const GLOBULAR_SHARE = 0.34; // share of the halo stars that belong to globular clusters

/**
 * Stellar halo: a sparse, slightly flattened cloud of old stars above and
 * below the disc, plus globular clusters (M31 has ~450 of them). Far fainter
 * than the disc, but it is what makes the galaxy read as a 3D object when the
 * camera orbits it.
 */
export function createHalo({ count, globulars, seed, sharedUniforms, brightness }) {
  const random = createRandom(seed, 4);
  const buffers = createStarBuffers(count);
  const order = shuffledIndices(count, random);
  const dir = { x: 0, y: 0, z: 0 };

  const clusterStars = globulars > 0 ? Math.round(count * GLOBULAR_SHARE) : 0;
  let n = 0;

  // Field halo: density falling steeply with radius.
  for (; n < count - clusterStars; n++) {
    const r = MODEL.haloInner + (MODEL.haloOuter - MODEL.haloInner) * Math.pow(random(), 2.3);
    randomDirection(random, dir);
    const bright = luminosity(random, 3.4);
    buffers.set(
      order[n],
      dir.x * r,
      dir.y * r * MODEL.haloFlattening,
      dir.z * r,
      1.1 + 0.8 * random() + 0.5 * bright,
      bright,
      0.16 + 0.28 * random(), // old, metal-poor: yellow-orange
      random(),
    );
  }

  // Globular clusters: tight balls of old stars.
  const perCluster = Math.max(1, Math.round(clusterStars / Math.max(globulars, 1)));
  while (n < count) {
    const r = 1.5 + 34 * Math.pow(random(), 1.7);
    randomDirection(random, dir);
    const cx = dir.x * r;
    const cy = dir.y * r * 0.85;
    const cz = dir.z * r;
    // Globulars are only a few parsecs across: from outside the galaxy each one
    // reads as a single fuzzy star that resolves into stars up close.
    const core = 0.003 + 0.006 * random(); // 3-9 pc, like real globular clusters
    const members = Math.min(count - n, perCluster);
    for (let k = 0; k < members; k++, n++) {
      // Plummer-like: a dense core with an extended envelope.
      const s = core * (1 + 3 * Math.pow(random(), 3));
      const bright = luminosity(random, 2.6);
      buffers.set(
        order[n],
        cx + gaussian(random) * s,
        cy + gaussian(random) * s,
        cz + gaussian(random) * s,
        1.2 + 0.7 * random() + 0.5 * bright,
        bright * 1.25,
        0.2 + 0.3 * random(),
        random(),
      );
    }
  }

  return createStarPopulation({
    name: 'HaloStars',
    buffers,
    sharedUniforms,
    motion: 'differential',
    motionScale: MODEL.haloRotation,
    brightness,
  });
}

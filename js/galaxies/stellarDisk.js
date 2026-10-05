import { createRandom, exponentialDiscRadius, gaussian, luminosity } from '../random.js';
import { createStarBuffers, createStarPopulation } from './starPoints.js';
import { tidalForward } from './galaxyMap.js';
import { STEP_MASK } from '../work.js';

/**
 * The old stellar disc: the smooth, yellow-white body of a spiral galaxy.
 *
 * Each star moves on its own slightly elliptical orbit (see MOTION_ELLIPSE in
 * stars.glsl.js). The orientation of the ellipses twists with radius, so they
 * crowd together along the spiral arms: a density wave. The stars keep their
 * differential speed (faster inside), flow through the arms and never wind
 * them up, however long the page stays open.
 *
 * `position` holds the orbit: semi-major axis, phase, vertical amplitude.
 *
 * Galaxies caught in an interaction (spec.static) are frozen in one
 * representative instant: the orbit is evaluated once on the CPU, then the
 * tidal deformation and the warp of the disc are applied.
 */
export async function buildStellarDisk({ count, spec, sharedUniforms, brightness, work, mapParams }) {
  const disk = spec.disk;
  const random = createRandom(spec.seed, 2);
  const buffers = createStarBuffers(count);
  const frozen = spec.static;
  const [flareBase, flareSlope] = disk.flare;
  const out = { x: 0, z: 0 };

  for (let i = 0; i < count; i++) {
    if ((i & STEP_MASK) === 0) await work.step();
    let a;
    do {
      a = exponentialDiscRadius(random, disk.scaleLength);
    } while (a < disk.inner || a > disk.outer);

    const phase = random() * Math.PI * 2;
    // The disc flares slightly outwards. y = h·cos(...) has a variance of h²/2,
    // hence the √2.
    const sigma = disk.oldSigma * (flareBase + flareSlope * a);
    const height = gaussian(random, 2.6) * sigma * Math.SQRT2;

    const bright = luminosity(random, 3.1);
    // Mostly G/K stars, a sprinkle of hotter F/A stars further out.
    let temperature = 0.2 + 0.36 * Math.pow(random(), 1.4);
    if (a > disk.hotRadius && random() < disk.hotFraction) temperature = 0.58 + 0.2 * random();
    const size = 1.2 + 0.8 * random() + 0.6 * bright;
    const seed = random();

    if (frozen) {
      // The orbit at t = 0 (same formula as MOTION_ELLIPSE), then deformed.
      const { tanPitch, ellipseOffset, eccentricity, eccWindow } = spec.orbits;
      const e = eccentricity * smooth(eccWindow[0], eccWindow[1], a) * (1 - smooth(eccWindow[2], eccWindow[3], a));
      const orientation = Math.log(a) / tanPitch + ellipseOffset;
      const ex = a * Math.cos(phase);
      const ez = a * (1 - e) * Math.sin(phase);
      const c = Math.cos(orientation);
      const s = Math.sin(orientation);
      tidalForward(mapParams, c * ex - s * ez, s * ex + c * ez, out);
      const y = height * Math.cos(seed * Math.PI * 2) + warpHeight(spec.warp, out.x, out.z);
      buffers.set(i, out.x, y, out.z, size, bright, temperature, seed);
    } else {
      buffers.set(i, a, phase, height, size, bright, temperature, seed);
    }
  }

  return createStarPopulation({
    name: `${spec.name}DiscStars`,
    buffers,
    sharedUniforms,
    motion: frozen ? null : 'ellipse',
    brightness,
  });
}

function smooth(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Height of the warped mid-plane (same as diskWarp() in the shaders). */
export function warpHeight(warp, x, z) {
  if (!warp) return 0;
  const r = Math.hypot(x, z);
  return warp.amp * smooth(warp.r0, warp.r1, r) * Math.sin(Math.atan2(z, x) - warp.angle);
}

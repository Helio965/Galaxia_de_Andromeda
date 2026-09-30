import { createRandom, exponentialDiscRadius, gaussian, luminosity } from './random.js';
import { createStarBuffers, createStarPopulation } from './starPoints.js';
import { MODEL } from './config.js';

/**
 * The old stellar disc: the smooth, yellow-white body of the galaxy.
 *
 * Each star moves on its own slightly elliptical orbit (see MOTION_ELLIPSE in
 * stars.glsl.js). The orientation of the ellipses twists with radius, so they
 * crowd together along the spiral arms: a density wave. The stars keep their
 * differential speed (faster inside), flow through the arms and never wind
 * them up, however long the page stays open.
 *
 * `position` holds the orbit: semi-major axis, phase, vertical amplitude.
 */
export function createStellarDisk({ count, seed, sharedUniforms, brightness }) {
  const random = createRandom(seed, 2);
  const buffers = createStarBuffers(count);

  for (let i = 0; i < count; i++) {
    let a;
    do {
      a = exponentialDiscRadius(random, MODEL.diskScaleLength);
    } while (a < MODEL.diskInner || a > MODEL.diskOuter);

    const phase = random() * Math.PI * 2;
    // The disc flares slightly outwards. y = h·cos(...) has a variance of h²/2,
    // hence the √2.
    const sigma = MODEL.oldSigma * (0.75 + 0.022 * a);
    const height = gaussian(random, 2.6) * sigma * Math.SQRT2;

    const bright = luminosity(random, 3.1);
    // Mostly G/K stars, a sprinkle of hotter F/A stars further out.
    let temperature = 0.2 + 0.36 * Math.pow(random(), 1.4);
    if (a > 7 && random() < 0.12) temperature = 0.58 + 0.2 * random();
    const size = 1.2 + 0.8 * random() + 0.6 * bright;

    buffers.set(i, a, phase, height, size, bright, temperature, random());
  }

  return createStarPopulation({
    name: 'DiscStars',
    buffers,
    sharedUniforms,
    motion: 'ellipse',
    brightness,
  });
}

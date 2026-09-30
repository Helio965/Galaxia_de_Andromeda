import { createRandom, gaussian, hernquistRadius, luminosity, randomDirection } from './random.js';
import { createStarBuffers, createStarPopulation } from './starPoints.js';
import { MODEL, LIGHT } from './config.js';

const SQRT_2PI = Math.sqrt(2 * Math.PI);
const NUCLEUS_FRACTION = 0.035;

/**
 * The galactic core: a large, flattened, slightly triaxial bulge of old stars
 * with a very compact nucleus at its heart.
 *
 * Two layers work together:
 *  - stars (THREE.Points): tens of thousands of warm points that give the
 *    bulge its grain and depth when the camera moves;
 *  - light: Gaussian ellipsoids integrated in the diffuse light volume
 *    (diffuseLight.js), a smooth white -> yellow -> gold glow whose HDR peak
 *    drives the bloom. The dust of the disc passes in front of it.
 */
export function createGalacticCore({ count, seed, sharedUniforms, brightness }) {
  const random = createRandom(seed, 1);
  const buffers = createStarBuffers(count);
  const dir = { x: 0, y: 0, z: 0 };

  for (let i = 0; i < count; i++) {
    let x;
    let y;
    let z;
    let temperature;
    let bright;
    if (random() < NUCLEUS_FRACTION) {
      // Nucleus: extremely dense, slightly whiter.
      const r = Math.abs(gaussian(random)) * 0.09;
      randomDirection(random, dir);
      x = dir.x * r;
      y = dir.y * r * 0.85;
      z = dir.z * r;
      temperature = 0.34 + 0.2 * random();
      bright = 0.6 + 0.4 * random();
    } else {
      const r = hernquistRadius(random, MODEL.bulgeScale, MODEL.bulgeMax);
      randomDirection(random, dir);
      x = dir.x * r;
      y = dir.y * r * MODEL.bulgeFlattening;
      z = dir.z * r * MODEL.bulgeDepth;
      // Old K/G giants; the few brightest are cooler (red giant branch tip).
      bright = luminosity(random, 3.2);
      temperature = 0.14 + 0.3 * random() - 0.08 * bright;
    }
    const size = 1.3 + 0.9 * random() + 0.6 * bright;
    buffers.set(i, x, y, z, size, bright, temperature, random());
  }

  const stars = createStarPopulation({
    name: 'BulgeStars',
    buffers,
    sharedUniforms,
    motion: 'differential',
    motionScale: MODEL.bulgeRotation,
    brightness,
  });

  return {
    stars,
    /** Gaussian components for the diffuse light: 1/σ per axis + peak emissivity. */
    lightComponents: LIGHT.bulge.map((c) => ({
      invSigma: [1 / c.sigma, 1 / (c.sigma * c.q), 1 / (c.sigma * MODEL.bulgeDepth)],
      // Peak emissivity giving the requested face-on surface brightness.
      emissivity: c.surface / (c.sigma * c.q * SQRT_2PI),
      color: c.color,
    })),
  };
}

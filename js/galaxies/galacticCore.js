import { createRandom, gaussian, hernquistRadius, luminosity, randomDirection } from '../random.js';
import { createStarBuffers, createStarPopulation } from './starPoints.js';
import { STEP_MASK } from '../work.js';

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/**
 * The spheroid of a galaxy: the bulge of a spiral (M31, the huge one of the
 * Sombrero) or the whole body of an elliptical (NGC 474, Centaurus A), with a
 * compact nucleus at its heart.
 *
 * Two layers work together:
 *  - stars (THREE.Points): tens of thousands of warm points that give the
 *    spheroid its grain and depth when the camera moves;
 *  - light: Gaussian ellipsoids integrated in the diffuse light volume
 *    (diffuseLight.js), a smooth white -> yellow -> gold glow whose HDR peak
 *    drives the bloom. The dust of the disc passes in front of it.
 *
 * spec.stars.bulge: scale (Hernquist radius), max, flattening, depth (z axis
 * ratio), nucleus (fraction), temperature [base, range].
 */
export async function buildGalacticCore({ count, spec, sharedUniforms, brightness, work, motion }) {
  const params = spec.stars.bulge;
  const random = createRandom(spec.seed, 1);
  const buffers = createStarBuffers(count);
  const dir = { x: 0, y: 0, z: 0 };
  const [t0, tRange] = params.temperature;

  for (let i = 0; i < count; i++) {
    if ((i & STEP_MASK) === 0) await work.step();
    let x;
    let y;
    let z;
    let temperature;
    let bright;
    if (random() < params.nucleus) {
      // Nucleus: extremely dense, slightly whiter.
      const r = Math.abs(gaussian(random)) * params.nucleusRadius;
      randomDirection(random, dir);
      x = dir.x * r;
      y = dir.y * r * 0.85;
      z = dir.z * r;
      temperature = 0.34 + 0.2 * random();
      bright = 0.6 + 0.4 * random();
    } else {
      const r = hernquistRadius(random, params.scale, params.max);
      randomDirection(random, dir);
      x = dir.x * r;
      y = dir.y * r * params.flattening;
      z = dir.z * r * params.depth;
      // Old K/G giants; the few brightest are cooler (red giant branch tip).
      bright = luminosity(random, 3.2);
      temperature = t0 + tRange * random() - 0.08 * bright;
    }
    const size = 1.3 + 0.9 * random() + 0.6 * bright;
    buffers.set(i, x, y, z, size, bright, temperature, random());
  }

  return createStarPopulation({
    name: `${spec.name}BulgeStars`,
    buffers,
    sharedUniforms,
    motion,
    motionScale: spec.rotation.bulge,
    brightness,
  });
}

/**
 * Gaussian components of the spheroid light, in the form the volume shader
 * wants: 1/σ per axis + peak emissivity, colour and orientation.
 * surface: peak surface brightness seen along the shortest axis.
 */
export function bulgeLightComponents(spec) {
  return spec.light.bulge.map((c) => {
    const axes = c.axes ?? [1, c.q, spec.stars.bulge.depth];
    const sigma = axes.map((a) => a * c.sigma);
    return {
      invSigma: sigma.map((s) => 1 / s),
      // Peak emissivity giving the requested face-on surface brightness.
      emissivity: c.surface / (sigma[1] * SQRT_2PI),
      color: c.color,
      angle: c.angle ?? 0,
      pattern: c.pattern ? 1 : 0,
      extent: Math.max(...sigma) * 3.2,
      height: sigma[1] * 3.2,
    };
  });
}

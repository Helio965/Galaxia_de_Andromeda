import { createRandom, gaussian, luminosity } from '../random.js';
import { createStarBuffers, createStarPopulation } from './starPoints.js';
import { STEP_MASK } from '../work.js';

/**
 * The stellar bar of a barred spiral (NGC 1300, M83): an elongated, boxy
 * structure of old stars that turns rigidly with the spiral pattern, the arms
 * starting at its ends. Its smooth light is an elongated Gaussian component
 * of the spheroid (see bulgeLightComponents) with the same length and angle;
 * the map adds the dust lanes along its leading edges and the young stars at
 * its tips.
 *
 * spec.stars.bar: length (half-length), width, height, angle (pattern frame).
 */
export async function buildBar({ count, spec, sharedUniforms, brightness, work }) {
  const bar = spec.stars.bar;
  const random = createRandom(spec.seed, 7);
  const buffers = createStarBuffers(count);
  const c = Math.cos(bar.angle);
  const s = Math.sin(bar.angle);

  for (let i = 0; i < count; i++) {
    if ((i & STEP_MASK) === 0) await work.step();
    // Boxy profile along the bar: flat in the middle, falling at the tips.
    let u;
    do {
      u = random() * 2 - 1;
    } while (random() > 1 - Math.pow(Math.abs(u), 4) * 0.85);
    const along = u * bar.length * (1 + 0.12 * gaussian(random, 2));
    const thin = 1 - 0.45 * Math.abs(u);
    const across = gaussian(random, 2.5) * bar.width * thin;
    const x = c * along - s * across;
    const z = s * along + c * across;
    const y = gaussian(random, 2.5) * bar.height * thin;
    const bright = luminosity(random, 3);
    buffers.set(i, x, y, z, 1.3 + 0.8 * random() + 0.6 * bright, bright, 0.2 + 0.28 * random(), random());
  }

  return createStarPopulation({
    name: `${spec.name}BarStars`,
    buffers,
    sharedUniforms,
    motion: spec.static ? null : 'pattern',
    brightness,
  });
}

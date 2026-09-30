import { createRandom, exponentialDiscRadius, gaussian, luminosity, shuffledIndices } from './random.js';
import { createStarBuffers, createStarPopulation } from './starPoints.js';
import { MODEL } from './config.js';

const ASSOCIATION_FRACTION = 0.32; // share of young stars born in OB associations
const MAX_TRIES = 64;

/**
 * The young population that draws the spiral arms and the 10 kpc ring:
 *  - field stars scattered along the arms (blue-white, some A/F, rare red supergiants);
 *  - OB associations: tight clumps of hot blue stars;
 *  - highlight supergiants: a few bright stars with a halo;
 *  - faint pink HII glows where stars are forming.
 *
 * Everything is placed by rejection sampling on the procedural map, so the
 * stars, the blue diffuse light and the dust lanes all agree. Positions are
 * in the frame of the spiral pattern, which turns rigidly (MOTION_PATTERN).
 */
export function createSpiralArms({ counts, seed, sampler, sharedUniforms, brightness }) {
  const random = createRandom(seed, 3);

  // --- Sampling helpers ------------------------------------------------------------
  const point = { x: 0, z: 0 };

  /** A point of the disc where `weight(x, z)` (0..1) is high. */
  function pickWhere(weight, scale, inner, outer, gamma) {
    for (let tries = 0; tries < MAX_TRIES; tries++) {
      const r = exponentialDiscRadius(random, scale);
      if (r < inner || r > outer) continue;
      const angle = random() * Math.PI * 2;
      point.x = r * Math.cos(angle);
      point.z = r * Math.sin(angle);
      if (random() < Math.pow(weight(point.x, point.z), gamma)) return point;
    }
    return point; // extremely rare: keep the last candidate
  }
  const young = (x, z) => Math.min(sampler.young(x, z) * 1.15, 1);
  const knots = (x, z) => Math.min(sampler.knots(x, z) * 1.6 + sampler.young(x, z) * 0.25, 1);

  function youngTemperature() {
    const u = random();
    if (u < 0.025) return 0.02 + 0.1 * random(); // red supergiant
    if (u < 0.12) return 0.48 + 0.2 * random(); // F / A
    return 0.7 + 0.3 * random(); // B / O
  }

  // --- Young stars: field + associations -------------------------------------------------
  const count = counts.arms;
  const buffers = createStarBuffers(count);
  const fieldCount = Math.round(count * (1 - ASSOCIATION_FRACTION));
  const order = shuffledIndices(count, random); // mixed order: any prefix is a fair sample
  let n = 0;

  for (; n < fieldCount; n++) {
    const p = pickWhere(young, 6.2, 2.8, 25, 1.25);
    const temperature = youngTemperature();
    const bright = luminosity(random, 3.3) * (temperature < 0.15 ? 1.8 : 1);
    buffers.set(
      order[n],
      p.x + gaussian(random) * 0.06,
      gaussian(random) * MODEL.youngSigma,
      p.z + gaussian(random) * 0.06,
      1.2 + 0.9 * random() + 0.7 * bright,
      bright,
      temperature,
      random(),
    );
  }

  const centers = [];
  while (n < count) {
    const c = pickWhere(knots, 6.5, 3.2, 24, 1.1);
    const cx = c.x;
    const cz = c.z;
    centers.push([cx, cz]);
    const members = Math.min(count - n, 18 + Math.floor(random() * 50));
    const spread = 0.07 + 0.16 * random();
    for (let k = 0; k < members; k++, n++) {
      const bright = luminosity(random, 2.8);
      buffers.set(
        order[n],
        cx + gaussian(random) * spread,
        gaussian(random) * MODEL.youngSigma * 0.6,
        cz + gaussian(random) * spread,
        1.3 + 0.9 * random() + 0.8 * bright,
        bright * 1.15,
        0.74 + 0.26 * random(),
        random(),
      );
    }
  }

  const stars = createStarPopulation({
    name: 'ArmStars',
    buffers,
    sharedUniforms,
    motion: 'pattern',
    brightness: brightness.arms,
  });

  // --- Highlight supergiants ------------------------------------------------------------
  const highlightBuffers = createStarBuffers(counts.highlights);
  for (let i = 0; i < counts.highlights; i++) {
    const inCluster = random() < 0.5 && centers.length > 0;
    let x;
    let z;
    if (inCluster) {
      const [cx, cz] = centers[Math.floor(random() * centers.length)];
      x = cx + gaussian(random) * 0.15;
      z = cz + gaussian(random) * 0.15;
    } else {
      const p = pickWhere(young, 6.2, 3, 24, 1.4);
      x = p.x;
      z = p.z;
    }
    const red = random() < 0.14;
    highlightBuffers.set(
      i,
      x,
      gaussian(random) * MODEL.youngSigma,
      z,
      1.5 + 1.0 * random(),
      0.5 + 1.3 * Math.pow(random(), 2.5),
      red ? 0.03 + 0.08 * random() : 0.72 + 0.28 * random(),
      random(),
    );
  }
  const highlights = createStarPopulation({
    name: 'Supergiants',
    buffers: highlightBuffers,
    sharedUniforms,
    motion: 'pattern',
    kind: 'highlight',
    spriteScale: 9,
    brightness: brightness.highlights,
  });

  // --- HII regions -----------------------------------------------------------------------
  const nebulaBuffers = createStarBuffers(counts.nebulae);
  for (let i = 0; i < counts.nebulae; i++) {
    let x;
    let z;
    if (centers.length > 0 && random() < 0.7) {
      const [cx, cz] = centers[Math.floor(random() * centers.length)];
      x = cx + gaussian(random) * 0.1;
      z = cz + gaussian(random) * 0.1;
    } else {
      const p = pickWhere(knots, 6.5, 3.2, 24, 1.5);
      x = p.x;
      z = p.z;
    }
    nebulaBuffers.set(
      i,
      x,
      gaussian(random) * MODEL.youngSigma * 0.5,
      z,
      5 + 12 * random(), // sprite size in px at the reference distance
      0.4 + 0.6 * random(),
      0,
      random(),
    );
  }
  const nebulae = createStarPopulation({
    name: 'HIIRegions',
    buffers: nebulaBuffers,
    sharedUniforms,
    motion: 'pattern',
    kind: 'nebula',
    brightness: brightness.nebulae,
  });

  return { stars, highlights, nebulae };
}

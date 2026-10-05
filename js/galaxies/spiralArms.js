import { createRandom, exponentialDiscRadius, gaussian, luminosity, shuffledIndices } from '../random.js';
import { createStarBuffers, createStarPopulation } from './starPoints.js';
import { warpHeight } from './stellarDisk.js';
import { STEP_MASK } from '../work.js';

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
 * in the frame of the spiral pattern, which turns rigidly (MOTION_PATTERN),
 * or frozen in place for galaxies caught in an interaction.
 *
 * The same code draws every young structure of the explorer: arms, the ring
 * of Hoag's Object, the ends of a bar, the knots of the Antennae.
 * spec.stars.arms: scale, inner, outer (radial sampling), associations,
 * knotScale, knotInner, knotOuter, spread (cluster size multiplier).
 */
export async function buildSpiralArms({ counts, spec, sampler, sharedUniforms, brightness, work }) {
  const params = spec.stars.arms;
  const youngSigma = spec.disk.youngSigma;
  const random = createRandom(spec.seed, 3);
  const motion = spec.static ? null : 'pattern';
  const lift = (x, z) => warpHeight(spec.warp, x, z);

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
  const fieldCount = Math.round(count * (1 - params.associations));
  const order = shuffledIndices(count, random); // mixed order: any prefix is a fair sample
  let n = 0;

  for (; n < fieldCount; n++) {
    if ((n & STEP_MASK) === 0) await work.step();
    const p = pickWhere(young, params.scale, params.inner, params.outer, 1.25);
    const temperature = youngTemperature();
    const bright = luminosity(random, 3.3) * (temperature < 0.15 ? 1.8 : 1);
    const x = p.x + gaussian(random) * 0.06;
    const y = gaussian(random) * youngSigma;
    const z = p.z + gaussian(random) * 0.06;
    buffers.set(
      order[n],
      x,
      y + lift(x, z),
      z,
      1.2 + 0.9 * random() + 0.7 * bright,
      bright,
      temperature,
      random(),
    );
  }

  const centers = [];
  while (n < count) {
    await work.step();
    const c = pickWhere(knots, params.knotScale, params.knotInner, params.knotOuter, 1.1);
    const cx = c.x;
    const cz = c.z;
    centers.push([cx, cz]);
    const members = Math.min(count - n, 18 + Math.floor(random() * 50));
    const spread = (0.07 + 0.16 * random()) * params.spread;
    const base = lift(cx, cz);
    for (let k = 0; k < members; k++, n++) {
      const bright = luminosity(random, 2.8);
      buffers.set(
        order[n],
        cx + gaussian(random) * spread,
        gaussian(random) * youngSigma * 0.6 + base,
        cz + gaussian(random) * spread,
        1.3 + 0.9 * random() + 0.8 * bright,
        bright * 1.15,
        0.74 + 0.26 * random(),
        random(),
      );
    }
  }

  const stars = createStarPopulation({
    name: `${spec.name}ArmStars`,
    buffers,
    sharedUniforms,
    motion,
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
      const p = pickWhere(young, params.scale, params.knotInner - 0.2, params.knotOuter, 1.4);
      x = p.x;
      z = p.z;
    }
    const red = random() < 0.14;
    highlightBuffers.set(
      i,
      x,
      gaussian(random) * youngSigma + lift(x, z),
      z,
      1.5 + 1.0 * random(),
      0.5 + 1.3 * Math.pow(random(), 2.5),
      red ? 0.03 + 0.08 * random() : 0.72 + 0.28 * random(),
      random(),
    );
  }
  const highlights = createStarPopulation({
    name: `${spec.name}Supergiants`,
    buffers: highlightBuffers,
    sharedUniforms,
    motion,
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
      const p = pickWhere(knots, params.knotScale, params.knotInner, params.knotOuter, 1.5);
      x = p.x;
      z = p.z;
    }
    nebulaBuffers.set(
      i,
      x,
      gaussian(random) * youngSigma * 0.5 + lift(x, z),
      z,
      5 + 12 * random(), // sprite size in px at the reference distance
      0.4 + 0.6 * random(),
      0,
      random(),
    );
  }
  const nebulae = createStarPopulation({
    name: `${spec.name}HIIRegions`,
    buffers: nebulaBuffers,
    sharedUniforms,
    motion,
    kind: 'nebula',
    brightness: brightness.nebulae,
  });

  return { stars, highlights, nebulae };
}

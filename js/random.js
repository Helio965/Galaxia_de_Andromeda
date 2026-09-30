/**
 * Deterministic randomness: the galaxy is generated from a seed, so it looks
 * exactly the same on every load (and a different `?seed=` gives a sibling).
 */

/** Small, fast seeded PRNG (mulberry32). Returns numbers in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Independent stream for one part of the scene, derived from the global seed. */
export function createRandom(seed, stream) {
  // Mix the stream id into the seed (hash-like) so streams do not overlap.
  let h = (seed ^ Math.imul(stream + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return mulberry32(h ^ (h >>> 16));
}

/** Standard normal sample (Box-Muller), clamped to ±limit. */
export function gaussian(random, limit = 3) {
  const u = Math.max(random(), 1e-9);
  const v = random();
  const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.min(Math.max(n, -limit), limit);
}

/**
 * Radius of a point in an exponential disc (surface density ∝ e^(-r/h)):
 * the radial distribution r·e^(-r/h) is a Gamma(2, h) law.
 */
export function exponentialDiscRadius(random, scale) {
  return -scale * Math.log(Math.max(random() * random(), 1e-12));
}

/**
 * Radius drawn from a Hernquist sphere (ρ ∝ 1 / (r (r + a)³)), a good match for
 * the light profile of bulges and elliptical galaxies. Truncated at `max`.
 */
export function hernquistRadius(random, scale, max) {
  const umax = (max / (max + scale)) ** 2; // cumulative mass inside `max`
  const s = Math.sqrt(random() * umax);
  return (scale * s) / (1 - s);
}

/** Uniform random direction; writes into `out` ({x, y, z}). */
export function randomDirection(random, out) {
  const z = random() * 2 - 1;
  const angle = random() * Math.PI * 2;
  const ring = Math.sqrt(1 - z * z);
  out.x = ring * Math.cos(angle);
  out.y = z;
  out.z = ring * Math.sin(angle);
  return out;
}

/**
 * Stellar luminosity function: most stars are faint, very few are bright.
 * Returns a value in (0, 1], heavily skewed towards small numbers.
 */
export function luminosity(random, steepness = 3) {
  return Math.pow(random(), steepness) * 0.94 + 0.06;
}

/**
 * Fisher-Yates shuffle of 0..count-1. Writing clustered stars in this order
 * makes any prefix of a population a fair, thinner sample of it.
 */
export function shuffledIndices(count, random) {
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  return order;
}

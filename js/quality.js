/**
 * Quality management: pick a profile for the GPU the browser is really using,
 * then lower it at runtime if the frame rate stays too low.
 *
 * `?quality=ultra|high|medium|low` forces a profile. A forced profile is only
 * lowered when the page is at real risk of freezing (a few FPS for several
 * seconds). `?adaptive=off` disables every automatic change (benchmarks).
 *
 * Particle counts were chosen from the per-frame work they generate (vertices,
 * blended fragments, volume samples): ULTRA keeps a dedicated laptop GPU
 * (RTX 3050 class) well under 16 ms at 1080p with M31 at full detail.
 */

export const PROFILES = {
  ultra: {
    name: 'ultra',
    // Stars of a galaxy of weight 1 (M31): 356 k, split between bulge, disc,
    // arms, supergiants, HII regions, halo and satellites (see the catalog).
    galaxyStars: 356000,
    maxDrawnStars: 560000, // all galaxies together, at the same time
    maxLoadedSystems: 3, // galaxies holding their stars in memory
    workBudgetMs: 7, // star generation per frame (time slicing)
    background: 45000,
    brightStars: 420,
    galaxies: 260, // faint background galaxies
    volumeSteps: 32, // max samples per pixel through the diffuse disc light
    volumeStepLength: 0.35, // kpc between samples (fewer when seen face-on)
    volumeScale: 1, // resolution of the diffuse light, relative to CSS pixels
    mapSize: 2048,
    maxPixelRatio: 2,
    finish: true, // vignette + dithering pass
  },
  high: {
    name: 'high',
    galaxyStars: 233000,
    maxDrawnStars: 360000,
    maxLoadedSystems: 3,
    workBudgetMs: 6,
    background: 32000,
    brightStars: 320,
    galaxies: 160,
    volumeSteps: 24,
    volumeStepLength: 0.45,
    volumeScale: 0.85,
    mapSize: 2048,
    maxPixelRatio: 1.75,
    finish: true,
  },
  medium: {
    name: 'medium',
    galaxyStars: 128000,
    maxDrawnStars: 190000,
    maxLoadedSystems: 2,
    workBudgetMs: 5,
    background: 18000,
    brightStars: 220,
    galaxies: 80,
    volumeSteps: 14,
    volumeStepLength: 0.65,
    volumeScale: 0.6,
    mapSize: 1024,
    maxPixelRatio: 1.25,
    finish: true,
  },
  low: {
    name: 'low',
    galaxyStars: 64000,
    maxDrawnStars: 90000,
    maxLoadedSystems: 2,
    workBudgetMs: 4,
    background: 9000,
    brightStars: 140,
    galaxies: 0,
    volumeSteps: 8,
    volumeStepLength: 0.9,
    volumeScale: 0.5,
    mapSize: 1024,
    maxPixelRatio: 1,
    finish: false,
  },
};

/**
 * @param {{ kind: string, tier: string }} gpu result of describeGpu()
 * @returns profile + { forced, adaptive, reason }
 */
export function chooseQuality(gpu, search = window.location.search) {
  const params = new URLSearchParams(search);
  const forced = (params.get('quality') || '').toLowerCase();
  const adaptive = params.get('adaptive') !== 'off';

  if (forced in PROFILES) {
    return { ...PROFILES[forced], forced: true, adaptive, reason: 'url' };
  }

  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const shortSide = Math.min(window.screen.width, window.screen.height);

  // Rendering on the CPU: keep it as light as possible.
  if (gpu.kind === 'software') {
    return { ...PROFILES.low, maxPixelRatio: 1, volumeSteps: 6, volumeStepLength: 1.2, forced: false, adaptive, reason: 'software' };
  }
  // Phones: small screen, tight power budget. A little extra resolution keeps stars crisp.
  if (coarsePointer && shortSide < 600) {
    return { ...PROFILES.low, maxPixelRatio: 1.5, forced: false, adaptive, reason: 'phone' };
  }
  // Tablets never get more than the medium profile.
  if (coarsePointer && gpu.tier !== 'low') {
    return { ...PROFILES.medium, forced: false, adaptive, reason: 'tablet' };
  }
  return { ...PROFILES[gpu.tier], forced: false, adaptive, reason: gpu.kind };
}

/**
 * Measures the frame rate over short windows and calls `onDowngrade` when it
 * stays below the target for `confirm` consecutive windows. After a change it
 * waits `warmup` seconds again, so the quality never flips back and forth.
 *
 * With `emergencyOnly` (forced profile) it only reacts to a near-freeze.
 */
export function createFrameRateGovernor({
  targetFps = 45,
  emergencyFps = 12,
  warmup = 3,
  sampleWindow = 2,
  confirm = 2,
  maxSteps = 10,
  emergencyOnly = false,
  onDowngrade,
}) {
  let running = 0;
  let elapsed = 0;
  let frames = 0;
  let strikes = 0;
  let steps = 0;

  const threshold = emergencyOnly ? emergencyFps : targetFps;
  const needed = emergencyOnly ? confirm + 1 : confirm;

  function reset() {
    running = 0;
    elapsed = 0;
    frames = 0;
    strikes = 0;
  }

  // Frames are not rendered while the tab is hidden: start over when it returns.
  document.addEventListener('visibilitychange', reset);

  return {
    reset,
    get steps() {
      return steps;
    },
    /** @param {number} delta unclamped seconds since the previous frame */
    tick(delta) {
      if (steps >= maxSteps) return;
      running += delta;
      if (running < warmup) return;

      elapsed += delta;
      frames += 1;
      if (elapsed < sampleWindow) return;

      const fps = frames / elapsed;
      elapsed = 0;
      frames = 0;
      strikes = fps < threshold ? strikes + 1 : 0;
      if (strikes < needed) return;

      // onDowngrade returns false when there is nothing left to lower.
      const changed = onDowngrade(fps, steps + 1) !== false;
      steps = changed ? steps + 1 : maxSteps;
      reset();
    },
  };
}

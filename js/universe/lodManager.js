import * as THREE from 'three';

/**
 * Level of detail of every galaxy, from its apparent size on the screen.
 *
 * The measure is the camera distance in units of the galaxy's radius,
 * corrected for the lens and the window height: `apparent` = (d / R) × (P₀ / P),
 * with P the pixels per radian of the current view and P₀ those of a 1080-pixel
 * high telephoto view (16°). So `apparent` 12 is a galaxy ~320 px in radius on
 * a 1080p screen, whatever the lens. Galaxies outside the field of view count
 * as 2.5× farther: their stars are not urgent.
 *
 *   LOD 0   apparent < 12    every star, sharpest map, most volume samples
 *   LOD 1   apparent < 22    ~75 % of the stars
 *   LOD 2   apparent < 45    ~40 % of the stars (fading in / out)
 *   LOD 3   apparent < 150   diffuse light only (fewer samples)
 *   LOD 4   beyond           diffuse light, minimum samples + a small beacon
 *
 * Changes use a hysteresis margin, so a camera hovering at a threshold does
 * not flicker between two levels. Stars are generated before they are needed
 * (from `apparent` 55, or as soon as a trip towards the galaxy starts), one
 * galaxy at a time and in time slices (see work.js): no freeze, no loading
 * screen. They fade in, fade out, and are released when the galaxy is small
 * on the screen again.
 *
 * A global budget caps the number of stars drawn at once, whatever the number
 * of galaxies nearby; the adaptive quality can lower it further.
 */
const THRESHOLDS = [12, 22, 45, 150];
const HYSTERESIS = 0.08;
const FRACTIONS = [1, 0.75, 0.4, 0, 0];
const STEP_FRACTIONS = [1, 0.85, 0.6, 0.35, 0.15];
const LOAD_BELOW = 55; // start generating the stars
const KEEP_BELOW = 75; // keep them while the galaxy looks bigger than this
const OFF_SCREEN = 2.5;
const REFERENCE_PROJECTION = 1080 / (2 * Math.tan(THREE.MathUtils.degToRad(8)));
const FADE_SPEED = 0.9; // per second
const FRACTION_SPEED = 1.5;

export function createLodManager({ universe, quality, work, log = console.info }) {
  const states = new Map(
    universe.systems.map((system) => [
      system,
      { level: 4, fraction: 0, fade: 0, failed: false },
    ]),
  );
  let job = null; // system whose stars are being generated
  let densityScale = 1; // user density × adaptive quality
  let stepsScale = 1;
  let budgetScale = 1;

  /** Keeps the current level while `apparent` stays within its band ± the margin. */
  function levelFor(state, apparent) {
    const level = state.level;
    const lower = level > 0 ? THRESHOLDS[level - 1] * (1 - HYSTERESIS) : 0;
    const upper = level < THRESHOLDS.length ? THRESHOLDS[level] * (1 + HYSTERESIS) : Infinity;
    if (apparent >= lower && apparent < upper) return level;
    const raw = THRESHOLDS.findIndex((threshold) => apparent < threshold);
    return raw < 0 ? THRESHOLDS.length : raw;
  }

  const frustum = new THREE.Frustum();
  const projection = new THREE.Matrix4();
  const sphere = new THREE.Sphere();

  function startLoad(system) {
    job = system;
    const stars = Math.round(quality.galaxyStars * system.entry.starWeight);
    log(`[GalaxyExplorer] Gerando ${system.entry.name}: ≈ ${Math.round(stars / 1000)} mil estrelas`);
    const started = performance.now();
    system
      .load(quality.galaxyStars, work)
      .then((done) => {
        if (done) {
          log(`[GalaxyExplorer] ${system.entry.name} pronta em ${((performance.now() - started) / 1000).toFixed(1)} s`);
        }
      })
      .catch((error) => {
        // Never hide a real error (shader, memory...): report it, keep the diffuse light.
        console.error(`[GalaxyExplorer] Falha ao gerar ${system.entry.name}:`, error);
        states.get(system).failed = true;
        system.unload();
      })
      .finally(() => {
        if (job === system) job = null;
      });
  }

  return {
    states,
    get busy() {
      return job;
    },
    /** User density (0..1) times the adaptive quality reduction. */
    setDensity(value) {
      densityScale = value;
    },
    /** Adaptive quality: fewer diffuse-light samples. */
    setStepsScale(value) {
      stepsScale = value;
    },
    /** Adaptive quality: lower global star budget. */
    setBudgetScale(value) {
      budgetScale = value;
    },

    /**
     * @param {THREE.PerspectiveCamera} camera (matrices up to date)
     * @param {number} viewHeight height of the view in CSS pixels
     * @param {number} delta seconds
     * @param {{ priority?: object, focus?: object }} hints travel target / observed galaxy
     */
    update(camera, viewHeight, delta, { priority = null, focus = null } = {}) {
      const pixelsPerRadian = viewHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      const lens = REFERENCE_PROJECTION / pixelsPerRadian;
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projection);

      // 1. Levels.
      const wanted = [];
      for (const [system, state] of states) {
        sphere.set(system.center, system.radius * 1.5);
        const inView = frustum.intersectsSphere(sphere);
        const relative = system.relativeDistance(camera.position) * lens * (inView ? 1 : OFF_SCREEN);
        const level = levelFor(state, relative);
        if (level !== state.level) {
          // Only the levels with stars are worth a message (no spam during trips).
          if (Math.min(level, state.level) <= 2) log(`[GalaxyExplorer] LOD ${system.entry.name} -> ${level}`);
          state.level = level;
          system.level = level;
          system.setSteps(STEP_FRACTIONS[level], stepsScale);
        }
        state.relative = relative;
        const important = system === priority || system === focus;
        state.wanted = !state.failed && (relative < LOAD_BELOW || system === priority);
        state.keep = state.wanted || relative < KEEP_BELOW || important;
        // Loaded galaxies stay candidates until KEEP_BELOW: no load / unload
        // ping-pong for a camera hovering around LOAD_BELOW.
        if (state.wanted || ((system.loaded || system.loading) && state.keep)) wanted.push(system);
      }

      // 2. Which galaxies may hold stars (the trip target first, then the nearest).
      wanted.sort((a, b) => {
        if (a === priority) return -1;
        if (b === priority) return 1;
        return states.get(a).relative - states.get(b).relative;
      });
      const allowed = new Set(wanted.slice(0, quality.maxLoadedSystems));

      // 3. Generate the next one (one at a time).
      if (!job) {
        const next = wanted.find(
          (system) => allowed.has(system) && states.get(system).wanted && !system.loaded && !system.loading,
        );
        if (next) startLoad(next);
      }

      // 4. Fades, fractions, release.
      let drawn = 0;
      for (const [system, state] of states) {
        const visible = system.loaded && allowed.has(system) && state.level <= 2;
        const fadeTarget = visible ? 1 : 0;
        state.fade = moveTowards(state.fade, fadeTarget, FADE_SPEED * delta);
        const fractionTarget = FRACTIONS[Math.min(state.level, 2)] * densityScale;
        state.fraction = system.loaded ? moveTowards(state.fraction, fractionTarget, FRACTION_SPEED * delta) : fractionTarget;

        if (system.loaded && state.fade === 0 && (!state.keep || !allowed.has(system))) {
          system.unload();
          log(`[GalaxyExplorer] Estrelas de ${system.entry.name} liberadas`);
        } else if (system.loading && (!state.keep || !allowed.has(system))) {
          system.unload(); // cancels the generation
          log(`[GalaxyExplorer] Geração de ${system.entry.name} cancelada`);
        }
        if (system.loaded) drawn += system.maxStarCount * Math.max(state.fraction, 0.01);
      }

      // 5. Global budget: scale every fraction down together if needed.
      const budget = quality.maxDrawnStars * budgetScale;
      const scale = drawn > budget ? budget / drawn : 1;
      for (const [system, state] of states) {
        if (!system.loaded) continue;
        system.setFraction(THREE.MathUtils.clamp(state.fraction * scale, 0.01, 1));
        system.setFade(state.fade);
      }
    },

    /** Re-applies the diffuse light samples (after an adaptive quality change). */
    refreshSteps() {
      for (const [system, state] of states) system.setSteps(STEP_FRACTIONS[state.level], stepsScale);
    },
  };
}

function moveTowards(value, target, step) {
  if (value < target) return Math.min(target, value + step);
  return Math.max(target, value - step);
}

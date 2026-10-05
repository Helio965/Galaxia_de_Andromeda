/**
 * Cooperative time slicing for heavy procedural work (generating the hundreds
 * of thousands of stars of a galaxy). Loops call `await work.step()` every few
 * thousand iterations; once the slice has used its budget, the work pauses
 * until the next frame, so the animation never freezes while a galaxy is
 * being prepared ahead of the camera.
 */

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** @param {number} budgetMs milliseconds of work per frame */
export function createWorkClock(budgetMs = 6) {
  let sliceStart = performance.now();
  return {
    budgetMs,
    /** Yields to the browser when the current slice is used up. */
    async step() {
      if (performance.now() - sliceStart < this.budgetMs) return;
      await nextFrame();
      sliceStart = performance.now();
    },
    /** Starts a fresh slice (call once per job). */
    reset() {
      sliceStart = performance.now();
    },
  };
}

/** Runs everything at once (used when nothing is on screen yet). */
export const IMMEDIATE = { budgetMs: Infinity, async step() {}, reset() {} };

/** How often loops check the clock: a power of two minus one, for `(i & STEP_MASK) === 0`. */
export const STEP_MASK = 2047;

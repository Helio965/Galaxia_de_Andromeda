import { MODEL, LIGHT } from './config.js';

/**
 * Dust lanes.
 *
 * Where: channel R of the procedural map (galaxyMap.js / shaders/map.glsl.js):
 * lanes on the inner edge of the arms, the dust ring near 10 kpc, tight arcs
 * around the bulge, broken into filaments and patches by noise.
 *
 * How: dust is a thin Gaussian layer (σ ≈ 110 pc) around the mid-plane that
 * only absorbs. Nothing is painted black:
 *  - every star computes, in its vertex shader, the dust column between
 *    itself and the camera (closed form, erf) and is dimmed by exp(-τ);
 *  - the diffuse light volume absorbs light step by step, front to back, so
 *    the bulge light behind the near side of the disc is cut by the lanes.
 * Blue light is absorbed ~2× more than red: the lanes look brown, and the
 * edges fade smoothly because τ does.
 *
 * Seen at M31's inclination (~77°), a sight line crosses ~4× more dust than
 * face-on, which is why the lanes stand out so clearly in the photographs.
 */
export function createDustUniforms() {
  return {
    uDustStrength: { value: LIGHT.dust },
    uDustSigma: { value: MODEL.dustSigma },
    uDustMaxColumn: { value: 3.5 },
  };
}

/** @param {number} level 0 = no dust, 1 = default, 2 = twice as opaque */
export function setDustLevel(uniforms, level) {
  uniforms.uDustStrength.value = LIGHT.dust * level;
}

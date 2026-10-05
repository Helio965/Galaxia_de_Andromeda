/**
 * Constants shared by every galaxy of the explorer.
 *
 * Scene units: 1 unit = 1 kiloparsec (kpc) ≈ 3 260 light-years. Inside a
 * galaxy, sizes follow the real ones roughly; the distances BETWEEN galaxies
 * are compressed (see universe/galaxyCatalog.js).
 *
 * Galaxy frame: the disc lies in the XZ plane, +Y is its rotation axis.
 * The parameters of each galaxy live in its catalog entry.
 */

/**
 * Sense of rotation. The arms are logarithmic spirals whose angle grows
 * outwards; turning the galaxies this way makes them trail, like real arms.
 */
export const SPIN = -1;

/** One kiloparsec in light-years. */
export const LIGHT_YEARS_PER_KPC = 3261.56;

/**
 * Pattern angular speed and rotation curve of a galaxy.
 * v(R) = V (1 - e^(-R / curveRadius)): rises in the bulge, flat in the disc;
 * V is chosen so that the stars at `corotation` turn as fast as the pattern.
 */
export function rotationParameters({ patternPeriod, corotation, curveRadius }) {
  const patternSpeed = (2 * Math.PI) / patternPeriod;
  const curveV = (patternSpeed * corotation) / (1 - Math.exp(-corotation / curveRadius));
  return { patternSpeed, curveV, curveRadius };
}

/**
 * The physical and visual model of M31, in one place.
 *
 * Scene units: 1 unit = 1 kiloparsec (kpc) ≈ 3 260 light-years.
 * Galaxy frame: the disc lies in the XZ plane, +Y is its rotation axis.
 *
 * Numbers loosely follow what is known about Andromeda (disc scale length
 * ~5 kpc, the star-forming ring at ~10 kpc, a large bright bulge, tightly
 * wound arms). They are tuned for the look of the reference photographs,
 * not for a scientific simulation.
 */

const DEG = Math.PI / 180;

/**
 * Sense of rotation. The arms are logarithmic spirals whose angle grows
 * outwards; turning the galaxy this way makes them trail, like real arms.
 */
export const SPIN = -1;

export const MODEL = {
  seed: 224, // M31 = NGC 224

  // --- Procedural map (arms, dust, star-forming knots) --------------------------
  mapRadius: 28, // half-size of the square map, in kpc

  // --- Spiral pattern ----------------------------------------------------------------
  tanPitch: Math.tan(11 * DEG), // M31's arms are tightly wound (pitch ~7-15°)
  // Old stars move on slightly elliptical orbits whose orientation follows the
  // arms: where the ellipses crowd together the density rises (density waves).
  // The offset below puts that crowding on the arms (measured numerically).
  ellipseOffset: 0.18 * Math.PI,
  eccentricity: 0.05,

  // --- Rotation ---------------------------------------------------------------------
  patternPeriod: 600, // seconds for one turn of the spiral pattern at speed 1×
  corotation: 12, // radius (kpc) where the stars turn as fast as the pattern
  curveRadius: 1.4, // v(R) = V (1 - e^(-R/curveRadius)): rises in the bulge, flat in the disc
  bulgeRotation: 0.55, // the bulge is partly pressure supported: it turns slower
  haloRotation: 0.12,

  // --- Disc ---------------------------------------------------------------------------
  diskScaleLength: 5.2,
  diskInner: 1.0,
  diskOuter: 26,
  oldSigma: 0.32, // vertical dispersion (kpc) of the old disc
  youngSigma: 0.1, // young stars, gas and dust stay close to the mid-plane
  dustSigma: 0.11,

  // --- Bulge --------------------------------------------------------------------------
  bulgeScale: 1.05, // Hernquist scale radius
  bulgeMax: 6.5,
  bulgeFlattening: 0.64, // vertical axis ratio
  bulgeDepth: 0.9, // slight triaxiality (z axis ratio)

  // --- Halo ----------------------------------------------------------------------------
  haloInner: 3,
  haloOuter: 60,
  haloFlattening: 0.75,

  // --- Presentation --------------------------------------------------------------------
  // In the photographs M31 runs diagonally across the frame, seen ~13° from edge-on.
  roll: 28 * DEG, // landscape screens
  rollPortrait: 58 * DEG, // tall screens: run along the long side
  visibleRadius: 24.5, // radius used to frame the galaxy on screen
};

/** Pattern angular speed (rad per galaxy second, unsigned). */
export const PATTERN_SPEED = (2 * Math.PI) / MODEL.patternPeriod;

/** Amplitude of the rotation curve so that corotation falls where configured. */
export const CURVE_V =
  (PATTERN_SPEED * MODEL.corotation) / (1 - Math.exp(-MODEL.corotation / MODEL.curveRadius));

/** Angular speed at radius R (same formula as in the shaders). */
export function angularSpeed(radius) {
  return (CURVE_V * (1 - Math.exp(-radius / MODEL.curveRadius))) / Math.max(radius, 1e-3);
}

/**
 * Light budget (HDR units, before exposure/tone mapping). The diffuse light is
 * what an unresolved galaxy looks like in a photograph; the particles add the
 * individual stars on top of it.
 */
export const LIGHT = {
  // Bulge as a sum of Gaussian ellipsoids (a cheap Sérsic-like profile).
  // surface: peak surface brightness seen face-on; sigma in kpc; q = vertical axis ratio.
  bulge: [
    { surface: 6.0, sigma: 0.05, q: 0.9, color: [1.0, 0.97, 0.92] }, // nucleus
    { surface: 1.35, sigma: 0.36, q: 0.8, color: [1.0, 0.92, 0.78] },
    { surface: 0.9, sigma: 1.15, q: 0.68, color: [1.0, 0.86, 0.64] },
    { surface: 0.36, sigma: 2.9, q: 0.56, color: [1.0, 0.82, 0.6] },
  ],
  disk: 0.3, // old disc surface brightness at R = 0 (face-on)
  young: 0.16, // blue arm light
  hii: 0.05, // pink star-forming knots
  dust: 9.0, // optical depth per kpc of dense dust (map value 1)
};

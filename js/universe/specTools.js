import * as THREE from 'three';

/**
 * Helpers to write galaxy specs without repeating hundreds of numbers: every
 * disc galaxy starts from a template (M31's parameters), is changed where its
 * structure differs, then scaled to its own physical size.
 */

/** Recursive merge: objects merge, arrays and values replace. Returns a new object. */
export function deepMerge(base, overrides) {
  if (overrides === undefined) return structuredClone(base);
  if (Array.isArray(overrides) || typeof overrides !== 'object' || overrides === null) return structuredClone(overrides);
  const out = structuredClone(base ?? {});
  for (const [key, value] of Object.entries(overrides)) {
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value) && base && typeof base[key] === 'object' && !Array.isArray(base[key])
        ? deepMerge(base[key], value)
        : structuredClone(value);
  }
  return out;
}

// For each map vec4: which components are lengths (L), noise frequencies (F)
// or dimensionless (-). Scaling a galaxy multiplies lengths by s and divides
// frequencies by s, so its whole structure keeps the same proportions.
const MAP_UNITS = {
  spurPatch: 'F---',
  youngEnv: 'LLLL',
  ring: 'LL--',
  ringShape: 'LL--',
  segments: 'F---',
  clouds: 'F---',
  knots: 'F---',
  innerEnv: 'LLLL',
  innerBreak: 'F---',
  dustRing: 'LL--',
  dustEnv: 'LLLL',
  dustMix: 'F-F-',
  diffuseDust: '-LLL',
  warp: 'FLFL',
  mix: '---F',
  bar: 'LL--',
  barDust: '-LL-',
  floc: '--F-',
  central: 'LL--',
  deform: '--L-',
  deformRange: 'LL--',
};

function scaleVec(values, units, s) {
  return values.map((v, i) => (units[i] === 'L' ? v * s : units[i] === 'F' ? v / s : v));
}

/**
 * Scales every length of a disc-galaxy spec by `s` (and noise frequencies by
 * 1/s). Surface brightnesses are intensive and stay; the dust opacity per kpc
 * is divided by s so the same lanes keep the same darkness.
 */
export function scaleSpec(spec, s) {
  if (s === 1) return structuredClone(spec);
  const out = structuredClone(spec);
  out.mapRadius *= s;
  if (out.map) {
    for (const [key, units] of Object.entries(MAP_UNITS)) {
      if (out.map[key]) out.map[key] = scaleVec(out.map[key], units, s);
    }
  }
  out.rotation.corotation *= s;
  out.orbits.eccWindow = out.orbits.eccWindow.map((v) => v * s);
  out.rotation.curveRadius *= s;
  if (out.disk) {
    for (const key of ['scaleLength', 'inner', 'outer', 'oldSigma', 'youngSigma', 'dustSigma', 'hotRadius']) out.disk[key] *= s;
    out.disk.flare = [out.disk.flare[0], out.disk.flare[1] / s];
  }
  const light = out.light;
  light.diskRadius *= s;
  light.oldRange = light.oldRange.map((v) => v * s);
  light.bulge = light.bulge.map((c) => ({ ...c, sigma: c.sigma * s }));
  light.dust /= s;
  const stars = out.stars;
  for (const key of ['scale', 'max', 'nucleusRadius']) stars.bulge[key] *= s;
  for (const key of ['scale', 'inner', 'outer', 'knotScale', 'knotInner', 'knotOuter']) stars.arms[key] *= s;
  for (const key of ['inner', 'outer', 'clusterRadius']) stars.halo[key] *= s;
  if (stars.bar) for (const key of ['length', 'width', 'height']) stars.bar[key] *= s;
  if (out.warp) for (const key of ['amp', 'r0', 'r1']) out.warp[key] *= s;
  return out;
}

const UP = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);

/**
 * "Picture frame" of a galaxy system seen from `viewDir` (unit vector from the
 * system towards the observer; world up = +Y, the celestial north): local x
 * points to the right of the picture, y towards the observer, z downwards,
 * like the axes of a photograph. Bodies placed in this frame appear on the
 * screen where they are in the reference image.
 * @returns {THREE.Quaternion}
 */
export function pictureFrame(viewDir, roll = 0) {
  const toward = new THREE.Vector3(...viewDir).normalize();
  const right = new THREE.Vector3().crossVectors(toward.clone().negate(), UP).normalize();
  const down = new THREE.Vector3().crossVectors(right, toward).normalize();
  const basis = new THREE.Matrix4().makeBasis(right, toward, down);
  const frame = new THREE.Quaternion().setFromRotationMatrix(basis);
  if (roll) frame.multiply(new THREE.Quaternion().setFromAxisAngle(UP, THREE.MathUtils.degToRad(roll)));
  return frame;
}

/**
 * Orientation of a disc inside a picture frame: turned around its own axis
 * (spin: phase of the arms), inclined around the horizontal (0 = face-on,
 * ±90 = edge-on; the sign picks which side is nearer), then turned in the
 * picture (positionAngle, counter-clockwise on the screen). Degrees.
 * @returns {THREE.Quaternion}
 */
export function discOrientation({ inclination = 0, positionAngle = 0, spin = 0 } = {}) {
  const deg = THREE.MathUtils.degToRad;
  const pa = new THREE.Quaternion().setFromAxisAngle(UP, deg(positionAngle));
  const tilt = new THREE.Quaternion().setFromAxisAngle(AXIS_X, deg(inclination));
  const turn = new THREE.Quaternion().setFromAxisAngle(UP, deg(spin));
  return pa.multiply(tilt).multiply(turn);
}

import * as THREE from 'three';
import { homePosition, TELE_FOV } from './observer.js';
import { EXPLORE_FOV } from './freeFlight.js';

const SAMPLES = 160; // arc-length table of the path
const CLEARANCE = 0.75; // × radius: the path keeps this far from other galaxies' centres

/** Phases of a trip, as shown in the interface. */
export const PHASES = [
  { until: 0.1, name: 'Alinhando' },
  { until: 0.32, name: 'Acelerando' },
  { until: 0.7, name: 'Em cruzeiro' },
  { until: 0.88, name: 'Desacelerando' },
  { until: 1.01, name: 'Aproximando' },
];

/**
 * "Viajar até": cinematic autopilot from wherever the camera is to the home
 * view of a galaxy (the direction of its photograph).
 *
 * The path is a cubic Bézier curve leaving along the current heading and
 * arriving along the galaxy's view axis, bent away from any galaxy core it
 * would cross. The camera first turns towards the path (align), accelerates,
 * cruises, decelerates and finally turns to face the galaxy (approach), then
 * stops: the explorer switches to observation mode around it.
 *
 * Any steering input cancels the trip; the camera then stops smoothly where
 * it is (see main.js). The trip's duration grows with the logarithm of the
 * distance: the long trips are faster, never tedious.
 */
export function createTravel({ camera, systems }) {
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const p3 = new THREE.Vector3();
  const table = new Float32Array(SAMPLES + 1);
  const startQuaternion = new THREE.Quaternion();
  const pathQuaternion = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const previous = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  let target = null;
  let duration = 1;
  let elapsed = -1;
  let startFov = EXPLORE_FOV;
  let length = 0;

  function bezier(t, out) {
    const u = 1 - t;
    return out
      .copy(p0)
      .multiplyScalar(u * u * u)
      .addScaledVector(p1, 3 * u * u * t)
      .addScaledVector(p2, 3 * u * t * t)
      .addScaledVector(p3, t * t * t);
  }

  const difference = new THREE.Vector3();
  function derivative(t, out) {
    const u = 1 - t;
    out.subVectors(p1, p0).multiplyScalar(3 * u * u);
    out.addScaledVector(difference.subVectors(p2, p1), 6 * u * t);
    return out.addScaledVector(difference.subVectors(p3, p2), 3 * t * t);
  }

  function buildTable() {
    let total = 0;
    bezier(0, previous);
    table[0] = 0;
    for (let i = 1; i <= SAMPLES; i++) {
      bezier(i / SAMPLES, point);
      total += point.distanceTo(previous);
      table[i] = total;
      previous.copy(point);
    }
    return total;
  }

  /** Curve parameter at a fraction of the arc length. */
  function parameterAt(fraction) {
    const goal = fraction * table[SAMPLES];
    let lo = 0;
    let hi = SAMPLES;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (table[mid] < goal) lo = mid;
      else hi = mid;
    }
    const span = table[hi] - table[lo] || 1;
    return (lo + (goal - table[lo]) / span) / SAMPLES;
  }

  /** Bends the control points away from galaxy cores the path would cross. */
  function avoidCores() {
    for (let iteration = 0; iteration < 6; iteration++) {
      let worst = null;
      let worstDepth = 0;
      for (let i = 1; i < 40; i++) {
        const t = i / 40;
        bezier(t, point);
        for (const system of systems) {
          // The destination is approached head-on; only its core matters, near the end.
          const clearance = system === target ? (t > 0.8 ? 0 : system.radius * 0.5) : system.radius * CLEARANCE;
          const depth = clearance - point.distanceTo(system.center);
          if (depth > worstDepth) {
            worstDepth = depth;
            worst = { system, point: point.clone() };
          }
        }
      }
      if (!worst) return;
      const away = worst.point.sub(worst.system.center);
      if (away.lengthSq() < 1e-6) away.set(0, 1, 0);
      away.normalize().multiplyScalar(worstDepth * 1.6 + 2);
      p1.add(away);
      p2.add(away);
    }
  }

  const travel = {
    get active() {
      return elapsed >= 0;
    },
    get target() {
      return target;
    },
    /** Fraction of the trip done (0..1). */
    get progress() {
      return elapsed < 0 ? 0 : Math.min(elapsed / duration, 1);
    },
    get phase() {
      const u = travel.progress;
      return PHASES.find((phase) => u < phase.until)?.name ?? 'Chegando';
    },
    /** Remaining distance to the arrival point (scene units). */
    get remaining() {
      return elapsed < 0 ? 0 : camera.position.distanceTo(p3);
    },
    velocity,
    get length() {
      return length;
    },

    start(system, currentFov) {
      target = system;
      p0.copy(camera.position);
      homePosition(system, camera.aspect, p3);
      length = p0.distanceTo(p3);
      const heading = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const reach = Math.max(length * 0.32, 1);
      p1.copy(p0).addScaledVector(heading, reach);
      p2.copy(p3).addScaledVector(system.viewDirection, reach);
      avoidCores();
      length = buildTable();
      duration = THREE.MathUtils.clamp(3.5 + 2.4 * Math.log2(1 + length / 40), 4, 15);
      startQuaternion.copy(camera.quaternion);
      startFov = currentFov;
      elapsed = 0;
      velocity.set(0, 0, 0);
      previous.copy(camera.position);
    },
    cancel() {
      elapsed = -1;
      target = null;
    },

    /**
     * Moves the camera along the path.
     * @returns {{ fov: number, done: boolean }}
     */
    update(delta) {
      elapsed = Math.min(elapsed + delta, duration);
      const u = elapsed / duration;
      // Motion along the path: still while aligning, then ease in / ease out.
      const m = THREE.MathUtils.clamp((u - 0.06) / 0.94, 0, 1);
      const s = m < 0.5 ? 4 * m * m * m : 1 - Math.pow(-2 * m + 2, 3) / 2;
      const t = parameterAt(s);
      previous.copy(camera.position);
      bezier(t, camera.position);
      if (delta > 0) velocity.subVectors(camera.position, previous).divideScalar(delta);

      // Look along the path, then at the galaxy for the approach.
      derivative(Math.max(t, 0.002), tangent).normalize();
      lookAt.copy(camera.position).addScaledVector(tangent, 50);
      const facing = THREE.MathUtils.smoothstep(u, 0.62, 0.95);
      lookAt.lerp(target.center, facing);
      matrix.lookAt(camera.position, lookAt, camera.up);
      pathQuaternion.setFromRotationMatrix(matrix);
      const align = THREE.MathUtils.smoothstep(u, 0, 0.14);
      camera.quaternion.slerpQuaternions(startQuaternion, pathQuaternion, align);

      // Lens: wide while travelling, telephoto on arrival (the home view).
      const cruise = THREE.MathUtils.smoothstep(u, 0, 0.2);
      const arrive = THREE.MathUtils.smoothstep(u, 0.7, 1);
      const fov = THREE.MathUtils.lerp(THREE.MathUtils.lerp(startFov, EXPLORE_FOV, cruise), TELE_FOV, arrive);

      const done = elapsed >= duration;
      if (done) {
        camera.position.copy(p3);
        camera.lookAt(target.center);
        velocity.set(0, 0, 0);
        elapsed = -1;
      }
      return { fov, done };
    },
  };
  return travel;
}

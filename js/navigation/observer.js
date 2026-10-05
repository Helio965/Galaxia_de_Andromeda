import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Lens: galaxies are photographed from millions of light-years away, with
// almost no perspective, so the "home" view of a galaxy uses a long
// (telephoto) lens. Closer, the lens widens: up close the galaxy surrounds
// the camera.
export const TELE_FOV = 16;
const WIDE_FOV = 34;
const WIDE_BELOW = 0.33; // distance / radius where the lens is fully wide
const TELE_ABOVE = 3.3; // ... and fully telephoto
const FILL = 0.94; // fraction of the screen a galaxy spans at its home position
const MIN_DISTANCE = 0.12; // × radius: soft limit, never inside the nucleus
const MAX_DISTANCE = 14; // × radius
const RESET_DURATION = 1.8;
const FOCUS_DURATION = 1.4;
const AUTO_ROTATE_SPEED = 0.22; // OrbitControls units: ~4.5 min per turn
const RESUME_DELAY = 7000; // ms without interaction before auto-rotation resumes
const UP = new THREE.Vector3(0, 1, 0);

/** Vertical field of view (degrees) at `distance` from a galaxy of radius `radius`. */
export function lensFor(distance, radius) {
  const t = THREE.MathUtils.smoothstep(distance / radius, WIDE_BELOW, TELE_ABOVE);
  return THREE.MathUtils.lerp(WIDE_FOV, TELE_FOV, t);
}

/**
 * What outlines a system as seen in its photograph: points on the rim of every
 * disc and along the tidal streams, spheres for the spheroids and shells.
 * Computed once.
 */
function outline(system) {
  const points = [];
  const spheres = [];
  const local = new THREE.Vector3();
  for (const body of system.bodies) {
    const spec = body.spec;
    const discRadius = spec.disk ? spec.light.diskRadius * 0.92 : 0;
    // Where each spheroid component fades below a faint surface brightness
    // (its very faint outer envelope does not count).
    const spheroid = Math.max(0, ...spec.light.bulge.map((c) => c.sigma * Math.sqrt(2 * Math.log(Math.max(c.surface / 0.05, 1)))));
    const shells = spec.stars.shells ? Math.max(...spec.stars.shells.map((s) => s.radius)) * 0.8 : 0;
    for (let i = 0; i < 48 && discRadius > 0; i++) {
      const angle = (i / 48) * Math.PI * 2;
      local.set(Math.cos(angle) * discRadius, 0, Math.sin(angle) * discRadius);
      points.push(local.clone().applyMatrix4(body.group.matrixWorld));
    }
    const round = Math.max(spheroid, shells);
    if (round > 0) spheres.push({ center: new THREE.Vector3().setFromMatrixPosition(body.group.matrixWorld), radius: round });
  }
  for (const stream of system.entry.tidal?.streams ?? []) {
    for (const p of stream.points) points.push(new THREE.Vector3(...p).applyMatrix4(system.group.matrixWorld));
  }
  return { points, spheres };
}

/**
 * Camera distance that frames a whole system from its photograph's direction,
 * for a given screen aspect, with the telephoto lens.
 */
export function framingDistance(system, aspect) {
  system.outline ??= outline(system);
  const forward = system.viewDirection.clone().negate();
  const right = new THREE.Vector3().crossVectors(forward, UP).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  let halfWidth = 0;
  let halfHeight = 0;
  const offset = new THREE.Vector3();
  for (const point of system.outline.points) {
    offset.subVectors(point, system.center);
    halfWidth = Math.max(halfWidth, Math.abs(offset.dot(right)));
    halfHeight = Math.max(halfHeight, Math.abs(offset.dot(up)));
  }
  for (const sphere of system.outline.spheres) {
    offset.subVectors(sphere.center, system.center);
    halfWidth = Math.max(halfWidth, Math.abs(offset.dot(right)) + sphere.radius);
    halfHeight = Math.max(halfHeight, Math.abs(offset.dot(up)) + sphere.radius);
  }
  const tanV = Math.tan(THREE.MathUtils.degToRad(TELE_FOV / 2));
  const tanH = tanV * aspect;
  const distance = Math.max(halfWidth / (FILL * tanH), halfHeight / (FILL * tanV));
  // The near side looks bigger than the far side: a small margin.
  return THREE.MathUtils.clamp(distance * 1.07, system.radius * TELE_ABOVE, system.radius * 12);
}

/** Home position of the camera for a system: in front of it, as in its photograph. */
export function homePosition(system, aspect, target = new THREE.Vector3()) {
  return target.copy(system.viewDirection).multiplyScalar(framingDistance(system, aspect)).add(system.center);
}

/**
 * Observation mode: OrbitControls around one galaxy (orbit, zoom, touch,
 * inertia), an animated "reset" flight to its home view, a smooth change of
 * focus when another galaxy is chosen, and a slow automatic orbit that pauses
 * while the user interacts.
 */
export function createObserver({ camera, canvas, autoRotate }) {
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false; // the galaxy always stays at the centre
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.9;
  controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
  controls.enabled = false;

  let system = null;
  let wantAutoRotate = autoRotate;
  let interacting = false;
  let resumeTimer = 0;
  const flight = createFlight(camera, controls);
  const focus = { from: new THREE.Vector3(), elapsed: -1 };

  function applyLimits() {
    controls.minDistance = system.radius * MIN_DISTANCE;
    controls.maxDistance = system.radius * MAX_DISTANCE;
  }

  controls.addEventListener('start', () => {
    interacting = true;
    clearTimeout(resumeTimer);
    controls.autoRotate = false;
    flight.cancel();
  });
  controls.addEventListener('end', () => {
    interacting = false;
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      controls.autoRotate = wantAutoRotate && !flight.active && controls.enabled;
    }, RESUME_DELAY);
  });

  return {
    controls,
    get system() {
      return system;
    },
    get active() {
      return controls.enabled;
    },
    get flying() {
      return flight.active || focus.elapsed >= 0;
    },

    /**
     * Starts observing `next` from wherever the camera is: the orbit centre
     * glides from the point the camera looks at to the galaxy.
     */
    start(next, { immediate = false } = {}) {
      system = next;
      applyLimits();
      controls.enabled = true;
      flight.cancel();
      if (immediate) {
        controls.target.copy(system.center);
        focus.elapsed = -1;
      } else {
        // Where the camera looks now, at the distance of the galaxy.
        const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        focus.from.copy(camera.position).addScaledVector(ahead, camera.position.distanceTo(system.center));
        controls.target.copy(focus.from);
        focus.elapsed = 0;
      }
      controls.update();
      controls.autoRotate = false;
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        controls.autoRotate = wantAutoRotate && controls.enabled && !interacting;
      }, RESUME_DELAY);
    },
    stop() {
      controls.enabled = false;
      controls.autoRotate = false;
      flight.cancel();
      focus.elapsed = -1;
      clearTimeout(resumeTimer);
    },
    /** Flies back to the home view of the observed galaxy. */
    reset() {
      if (!system) return;
      controls.autoRotate = false;
      focus.elapsed = -1;
      controls.target.copy(system.center);
      flight.start(homePosition(system, camera.aspect));
    },
    /** Puts the camera at the home view at once (startup). */
    home() {
      camera.position.copy(homePosition(system, camera.aspect));
      controls.target.copy(system.center);
      camera.up.copy(UP);
      camera.lookAt(system.center);
      controls.update();
    },
    setAutoRotate(enabled) {
      wantAutoRotate = enabled;
      clearTimeout(resumeTimer);
      controls.autoRotate = enabled && controls.enabled && !interacting && !flight.active;
    },
    /** @returns {number} the field of view this mode wants */
    update(delta) {
      if (focus.elapsed >= 0) {
        focus.elapsed = Math.min(focus.elapsed + delta, FOCUS_DURATION);
        const t = focus.elapsed / FOCUS_DURATION;
        const ease = t * t * (3 - 2 * t);
        controls.target.lerpVectors(focus.from, system.center, ease);
        if (focus.elapsed >= FOCUS_DURATION) focus.elapsed = -1;
      }
      if (flight.active) {
        if (!flight.update(delta, system.center)) {
          controls.update(delta);
          controls.autoRotate = wantAutoRotate && !interacting;
        }
      } else {
        controls.update(delta);
      }
      return lensFor(camera.position.distanceTo(system.center), system.radius);
    },
  };
}

/**
 * Smoothly flies the camera to a position around the target. Interpolating in
 * spherical coordinates keeps it on an arc instead of cutting through the core.
 */
function createFlight(camera, controls) {
  const from = new THREE.Spherical();
  const to = new THREE.Spherical();
  const offset = new THREE.Vector3();
  let elapsed = -1;

  return {
    get active() {
      return elapsed >= 0;
    },
    start(destination) {
      from.setFromVector3(offset.subVectors(camera.position, controls.target));
      to.setFromVector3(offset.subVectors(destination, controls.target));
      const turn = to.theta - from.theta; // the short way around
      to.theta = from.theta + Math.atan2(Math.sin(turn), Math.cos(turn));
      // Drop any leftover inertia from the controls.
      controls._sphericalDelta?.set(0, 0, 0);
      controls._scale = 1;
      elapsed = 0;
    },
    cancel() {
      elapsed = -1;
    },
    update(delta, target) {
      if (elapsed < 0) return false;
      elapsed = Math.min(elapsed + delta, RESET_DURATION);
      const t = elapsed / RESET_DURATION;
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      camera.position
        .setFromSphericalCoords(
          THREE.MathUtils.lerp(from.radius, to.radius, ease),
          THREE.MathUtils.lerp(from.phi, to.phi, ease),
          THREE.MathUtils.lerp(from.theta, to.theta, ease),
        )
        .add(target);
      camera.lookAt(target);
      if (elapsed >= RESET_DURATION) {
        elapsed = -1;
        return false;
      }
      return true;
    },
  };
}

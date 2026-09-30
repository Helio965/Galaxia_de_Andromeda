import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MODEL } from './config.js';

// Lens: M31 is 2.5 million light-years away and its photographs have almost no
// perspective, so the home view uses a long (telephoto) lens. Flying closer
// widens it progressively: up close the galaxy surrounds the camera.
export const TELE_FOV = 16;
const WIDE_FOV = 34;
const WIDE_BELOW = 8; // distance (kpc) where the lens is fully wide
const TELE_ABOVE = 80; // distance where it is fully telephoto
const ELEVATION = THREE.MathUtils.degToRad(16); // camera height above the world XZ plane
const MIN_DISTANCE = 5; // never fly into the nucleus
const MAX_DISTANCE = 420;
const FILL = 0.94; // fraction of the screen the disc spans at the home position
const RESET_DURATION = 1.8;
const AUTO_ROTATE_SPEED = 0.22; // OrbitControls units: ~4.5 min per turn
const RESUME_DELAY = 7000; // ms without interaction before auto-rotation resumes

/**
 * Roll of the galaxy in the picture: diagonal on wide screens (like the
 * photographs), steeper on tall screens so the disc uses the long side.
 */
export function homeRoll(aspect) {
  const t = THREE.MathUtils.smoothstep(aspect, 0.6, 1.25);
  return THREE.MathUtils.lerp(MODEL.rollPortrait, MODEL.roll, t);
}

/** Vertical field of view (degrees) for a camera at `distance` from the centre. */
export function lensFor(distance) {
  const t = THREE.MathUtils.smoothstep(distance, WIDE_BELOW, TELE_ABOVE);
  return THREE.MathUtils.lerp(WIDE_FOV, TELE_FOV, t);
}

/** Camera distance that frames the whole visible disc for a given aspect. */
export function homeDistance(aspect, roll) {
  const major = MODEL.visibleRadius;
  const minor = major * Math.sin(THREE.MathUtils.degToRad(15)); // disc seen ~15° from edge-on
  const halfWidth = Math.hypot(major * Math.cos(roll), minor * Math.sin(roll));
  const halfHeight = Math.hypot(major * Math.sin(roll), minor * Math.cos(roll));
  const tanV = Math.tan(THREE.MathUtils.degToRad(TELE_FOV / 2));
  const tanH = tanV * aspect;
  const distance = Math.max(halfWidth / (FILL * tanH), halfHeight / (FILL * tanV));
  // The near side of the disc is closer to the camera and looks bigger: add a margin.
  return THREE.MathUtils.clamp(distance * 1.03, TELE_ABOVE, 360);
}

function homePosition(aspect, roll, target = new THREE.Vector3()) {
  const distance = homeDistance(aspect, roll);
  return target.set(0, Math.sin(ELEVATION), Math.cos(ELEVATION)).multiplyScalar(distance);
}

/**
 * Perspective camera + OrbitControls (orbit, zoom, touch, inertia), an animated
 * "reset" flight and a slow automatic orbit that pauses while the user interacts.
 */
export function createCameraRig({ canvas, aspect, autoRotate }) {
  const camera = new THREE.PerspectiveCamera(TELE_FOV, aspect, 0.05, 20000);
  const rig = {
    camera,
    controls: null,
    roll: homeRoll(aspect), // galaxy roll, animated by the reset flight
    autoRotate,
  };
  homePosition(aspect, rig.roll, camera.position);
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false; // the galaxy always stays at the centre
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.9;
  controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
  controls.autoRotate = autoRotate;
  controls.target.set(0, 0, 0);
  controls.update();
  rig.controls = controls;

  // --- Automatic rotation: pause while the user drives the camera --------------------
  let resumeTimer = 0;
  let interacting = false;
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
      controls.autoRotate = rig.autoRotate && !flight.active;
    }, RESUME_DELAY);
  });

  rig.setAutoRotate = (enabled) => {
    rig.autoRotate = enabled;
    clearTimeout(resumeTimer);
    controls.autoRotate = enabled && !interacting && !flight.active;
  };

  // --- Reset flight -------------------------------------------------------------------------
  const flight = createFlight(rig);
  rig.reset = () => {
    controls.autoRotate = false;
    flight.start();
  };

  /** @returns {boolean} true when the lens (field of view) changed */
  rig.update = (delta) => {
    if (flight.active) {
      if (!flight.update(delta)) {
        controls.update(delta); // resync the controls with the final position
        controls.autoRotate = rig.autoRotate && !interacting;
      }
    } else {
      controls.update(delta);
    }
    const fov = lensFor(camera.position.distanceTo(controls.target));
    if (Math.abs(fov - camera.fov) < 1e-4) return false;
    camera.fov = fov;
    camera.updateProjectionMatrix();
    return true;
  };

  rig.setAspect = (value) => {
    camera.aspect = value;
    camera.updateProjectionMatrix();
  };

  return rig;
}

/**
 * Smoothly flies the camera back home. Interpolating in spherical coordinates
 * keeps it on an arc around the galaxy instead of cutting through the core.
 */
function createFlight(rig) {
  const { camera, controls } = rig;
  const from = new THREE.Spherical();
  const to = new THREE.Spherical();
  const home = new THREE.Vector3();
  let fromRoll = 0;
  let toRoll = 0;
  let elapsed = -1;

  return {
    get active() {
      return elapsed >= 0;
    },
    start() {
      from.setFromVector3(camera.position);
      toRoll = homeRoll(camera.aspect);
      fromRoll = rig.roll;
      to.setFromVector3(homePosition(camera.aspect, toRoll, home));
      // Take the short way around.
      const turn = to.theta - from.theta;
      to.theta = from.theta + Math.atan2(Math.sin(turn), Math.cos(turn));
      // Drop any leftover inertia from the controls.
      controls._sphericalDelta?.set(0, 0, 0);
      controls._scale = 1;
      elapsed = 0;
    },
    cancel() {
      elapsed = -1;
    },
    /** @returns {boolean} true while the flight is still running */
    update(delta) {
      if (elapsed < 0) return false;
      elapsed = Math.min(elapsed + delta, RESET_DURATION);
      const t = elapsed / RESET_DURATION;
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      camera.position.setFromSphericalCoords(
        THREE.MathUtils.lerp(from.radius, to.radius, ease),
        THREE.MathUtils.lerp(from.phi, to.phi, ease),
        THREE.MathUtils.lerp(from.theta, to.theta, ease),
      );
      rig.roll = THREE.MathUtils.lerp(fromRoll, toRoll, ease);
      camera.lookAt(controls.target);
      if (elapsed >= RESET_DURATION) {
        elapsed = -1;
        return false;
      }
      return true;
    },
  };
}

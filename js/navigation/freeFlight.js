import * as THREE from 'three';

export const EXPLORE_FOV = 55;
const LOOK_SENSITIVITY = 0.0021; // radians per pixel of mouse motion
const TOUCH_LOOK = 0.0045;
const LOOK_SMOOTHING = 16; // per second
const ACCELERATION = 3.2; // velocity response (per second): inertia
const BOOST_MAX = 9; // Shift held: speed multiplied up to ×9...
const BOOST_RAMP = 2.4; // ... reached after this many seconds
const SLOW = 0.2; // X held
const MIN_SPEED = 0.2; // units per second
const MAX_SPEED = 110;
const NUCLEUS = 0.07; // × radius: soft limit around the centre of a galaxy
const PITCH_LIMIT = THREE.MathUtils.degToRad(88);

const KEYS = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  KeyE: 'up',
  KeyQ: 'down',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
  KeyX: 'slow',
};

/**
 * Exploration mode: free flight through the universe.
 *
 *  - W/S A/D move, E/Q up and down, the mouse looks around (click the scene
 *    to capture the cursor, Esc releases it; without pointer lock, dragging
 *    also looks around), the wheel sets the speed.
 *  - Shift boosts progressively (the longer it is held, the faster), X slows.
 *  - The base speed follows the distance to the nearest galaxy: slow and
 *    precise inside a galaxy, fast in the void between galaxies.
 *  - Velocity and look direction are smoothed (inertia), so the flight never
 *    jerks. No invisible walls: only a soft push away from the very centre of
 *    a galaxy.
 *  - Touch: one finger looks around, two fingers pinch to fly forward/back.
 *
 * Keys are ignored while typing in a control or with Ctrl/Alt/Meta held
 * (Ctrl+W must still close the tab).
 */
export function createFreeFlight({ camera, canvas }) {
  const pressed = new Set();
  const velocity = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const move = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const look = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0 };
  let active = false;
  let speedMultiplier = 1;
  let boost = 1;
  let baseSpeed = 1;
  let dragging = null;
  const touches = new Map();
  let pinch = null;
  let pinchMove = 0;
  const listeners = new Set();

  function emitInput() {
    for (const listener of listeners) listener();
  }

  function syncFromCamera() {
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    look.yaw = look.targetYaw = euler.y;
    look.pitch = look.targetPitch = THREE.MathUtils.clamp(euler.x, -PITCH_LIMIT, PITCH_LIMIT);
  }

  function rotate(dx, dy, sensitivity) {
    look.targetYaw -= dx * sensitivity;
    look.targetPitch = THREE.MathUtils.clamp(look.targetPitch - dy * sensitivity, -PITCH_LIMIT, PITCH_LIMIT);
  }

  function ignored(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return true;
    const target = event.target;
    return target instanceof HTMLElement && Boolean(target.closest('input, select, textarea'));
  }

  // --- Keyboard ------------------------------------------------------------------
  window.addEventListener('keydown', (event) => {
    const key = KEYS[event.code];
    if (!key || !active || ignored(event)) return;
    pressed.add(key);
    if (key !== 'boost' && key !== 'slow') emitInput();
    if (event.code.startsWith('Arrow')) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    const key = KEYS[event.code];
    if (key) pressed.delete(key);
  });
  window.addEventListener('blur', () => pressed.clear());

  // --- Mouse -------------------------------------------------------------------------
  canvas.addEventListener('mousedown', (event) => {
    if (!active || event.button !== 0) return;
    if (document.pointerLockElement !== canvas && canvas.requestPointerLock) {
      // Some browsers return a promise that rejects (e.g. right after Esc): drag instead.
      try {
        const request = canvas.requestPointerLock();
        request?.catch?.(() => {});
      } catch {
        /* drag to look */
      }
    }
    dragging = { x: event.clientX, y: event.clientY };
  });
  window.addEventListener('mouseup', () => {
    dragging = null;
  });
  document.addEventListener('mousemove', (event) => {
    if (!active) return;
    if (document.pointerLockElement === canvas) {
      rotate(event.movementX, event.movementY, LOOK_SENSITIVITY);
      emitInput();
    } else if (dragging) {
      rotate(event.clientX - dragging.x, event.clientY - dragging.y, LOOK_SENSITIVITY);
      dragging = { x: event.clientX, y: event.clientY };
      emitInput();
    }
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!active) return;
      event.preventDefault();
      const notches = THREE.MathUtils.clamp(-event.deltaY / 100, -3, 3);
      speedMultiplier = THREE.MathUtils.clamp(speedMultiplier * Math.pow(1.18, notches), 0.05, 25);
    },
    { passive: false },
  );

  // --- Touch -------------------------------------------------------------------------
  canvas.addEventListener('touchstart', (event) => {
    if (!active) return;
    for (const touch of event.changedTouches) touches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
    emitInput();
  }, { passive: true });
  canvas.addEventListener('touchmove', (event) => {
    if (!active) return;
    event.preventDefault();
    for (const touch of event.changedTouches) {
      const previous = touches.get(touch.identifier);
      if (!previous) continue;
      if (touches.size === 1) rotate(touch.clientX - previous.x, touch.clientY - previous.y, TOUCH_LOOK);
      touches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }
    if (touches.size === 2 && pinch) {
      const [a, b] = [...touches.values()];
      const spread = Math.hypot(a.x - b.x, a.y - b.y);
      // Fingers apart: forward; together: back. Proportional to the spread change.
      pinchMove = THREE.MathUtils.clamp((spread - pinch) / 120, -1, 1);
    }
  }, { passive: false });
  const endTouch = (event) => {
    for (const touch of event.changedTouches) touches.delete(touch.identifier);
    if (touches.size < 2) {
      pinch = null;
      pinchMove = 0;
    }
  };
  canvas.addEventListener('touchend', endTouch);
  canvas.addEventListener('touchcancel', endTouch);

  return {
    velocity,
    get active() {
      return active;
    },
    get speedMultiplier() {
      return speedMultiplier;
    },
    /** Current boost factor (1 = none), for the visual cues of speed. */
    get boost() {
      return boost;
    },
    get speed() {
      return velocity.length();
    },
    /** Called on any steering input (used to cancel an autopilot trip). */
    onInput(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start({ keepVelocity = null } = {}) {
      active = true;
      syncFromCamera();
      if (keepVelocity) velocity.copy(keepVelocity);
      else velocity.set(0, 0, 0);
    },
    stop() {
      active = false;
      pressed.clear();
      dragging = null;
      velocity.set(0, 0, 0);
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    },
    /** True while a movement key is held (keyboard or pinch). */
    get steering() {
      return pressed.size > 0 || pinchMove !== 0;
    },

    /**
     * @param {number} delta seconds
     * @param {{ system, distance }} nearest nearest galaxy and the distance to its surface
     */
    update(delta, nearest) {
      if (!active) return;
      // Look: smoothed towards the target angles.
      const k = 1 - Math.exp(-LOOK_SMOOTHING * delta);
      look.yaw += (look.targetYaw - look.yaw) * k;
      look.pitch += (look.targetPitch - look.pitch) * k;
      euler.set(look.pitch, look.yaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(euler);

      // Speed scaled by the distance to the nearest galaxy.
      const scale = nearest.system ? nearest.system.radius * 0.05 : 1;
      baseSpeed = THREE.MathUtils.clamp(scale + nearest.distance * 0.32, MIN_SPEED, MAX_SPEED);
      boost = pressed.has('boost') ? Math.min(BOOST_MAX, boost + ((BOOST_MAX - 1) / BOOST_RAMP) * delta * Math.sqrt(boost)) : 1;
      const speed = baseSpeed * speedMultiplier * boost * (pressed.has('slow') ? SLOW : 1);

      move.set(
        (pressed.has('right') ? 1 : 0) - (pressed.has('left') ? 1 : 0),
        (pressed.has('up') ? 1 : 0) - (pressed.has('down') ? 1 : 0),
        (pressed.has('back') ? 1 : 0) - (pressed.has('forward') ? 1 : 0) - pinchMove,
      );
      if (move.lengthSq() > 1) move.normalize();
      desired.copy(move).applyQuaternion(camera.quaternion).multiplyScalar(speed);
      velocity.lerp(desired, 1 - Math.exp(-ACCELERATION * delta));
      if (velocity.lengthSq() < 1e-8) velocity.set(0, 0, 0);
      camera.position.addScaledVector(velocity, delta);

      // Soft limit near a nucleus: a gentle push outwards, never a wall.
      const system = nearest.system;
      if (system) {
        const limit = system.radius * NUCLEUS;
        const offset = camera.position.clone().sub(system.center);
        const distance = offset.length();
        if (distance < limit && distance > 1e-6) {
          const push = (limit - distance) * (1 - Math.exp(-4 * delta));
          camera.position.addScaledVector(offset.divideScalar(distance), push);
          velocity.multiplyScalar(Math.exp(-3 * delta));
        }
      }
    },
  };
}

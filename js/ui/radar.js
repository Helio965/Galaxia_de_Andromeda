import * as THREE from 'three';

/**
 * Radar (M): a small top-down map of the explorer around the camera, turned
 * with the camera's heading (up = ahead). Galaxies are dots in their colour,
 * the selected one is circled, the starting point (our Galaxy) is a cross.
 * The scale adapts to the farthest galaxy, logarithmically, so both the
 * neighbours and the far side of the explorer fit.
 */
export function createRadar({ systems }) {
  const canvas = document.getElementById('radar');
  const context = canvas.getContext('2d');
  const forward = new THREE.Vector3();
  const offset = new THREE.Vector3();
  let size = 0;
  let ratio = 1;
  let visible = !canvas.hidden;

  function resize() {
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    size = canvas.clientWidth;
    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);
  }

  /** Radial log scale: distance -> fraction of the radius. */
  const scale = (distance) => Math.min(1, Math.log1p(distance / 40) / Math.log1p(1100 / 40));

  function plot(cx, cy, radius, heading, position, point) {
    offset.subVectors(point, position);
    const angle = Math.atan2(offset.x, -offset.z) - heading; // 0 = ahead
    const r = scale(Math.hypot(offset.x, offset.z)) * radius;
    return [cx + Math.sin(angle) * r, cy - Math.cos(angle) * r];
  }

  return {
    get visible() {
      return visible;
    },
    setVisible(value) {
      visible = value;
      canvas.hidden = !value;
      if (value) resize();
    },
    resize,
    draw(camera, selected, focus) {
      if (!visible) return;
      if (!size) resize();
      const w = canvas.width;
      const cx = w / 2;
      const cy = w / 2;
      const radius = w / 2 - 6 * ratio;
      context.clearRect(0, 0, w, w);

      // Rings at 10, 100 and 1000 units.
      context.strokeStyle = 'rgba(176, 198, 255, 0.14)';
      context.lineWidth = ratio;
      for (const d of [10, 100, 1000]) {
        context.beginPath();
        context.arc(cx, cy, scale(d) * radius, 0, Math.PI * 2);
        context.stroke();
      }

      camera.getWorldDirection(forward);
      const heading = Math.atan2(forward.x, -forward.z);
      const position = camera.position;

      // Starting point (our Galaxy).
      const [ox, oy] = plot(cx, cy, radius, heading, position, offset.set(0, 0, 0).clone());
      context.strokeStyle = 'rgba(231, 236, 246, 0.6)';
      context.beginPath();
      context.moveTo(ox - 3 * ratio, oy);
      context.lineTo(ox + 3 * ratio, oy);
      context.moveTo(ox, oy - 3 * ratio);
      context.lineTo(ox, oy + 3 * ratio);
      context.stroke();

      for (const system of systems) {
        const [x, y] = plot(cx, cy, radius, heading, position, system.center);
        // Above / below the camera: brighter / dimmer.
        const height = THREE.MathUtils.clamp((system.center.y - position.y) / 300, -1, 1);
        context.globalAlpha = 0.75 + 0.25 * height;
        context.fillStyle = system.entry.color;
        context.beginPath();
        context.arc(x, y, (system === focus ? 3.2 : 2.4) * ratio, 0, Math.PI * 2);
        context.fill();
        if (system === selected) {
          context.globalAlpha = 1;
          context.strokeStyle = system.entry.color;
          context.beginPath();
          context.arc(x, y, 6 * ratio, 0, Math.PI * 2);
          context.stroke();
        }
      }
      context.globalAlpha = 1;

      // The camera, heading up.
      context.fillStyle = '#e7ecf6';
      context.beginPath();
      context.moveTo(cx, cy - 5 * ratio);
      context.lineTo(cx - 3.5 * ratio, cy + 4 * ratio);
      context.lineTo(cx + 3.5 * ratio, cy + 4 * ratio);
      context.closePath();
      context.fill();
    },
  };
}

import * as THREE from 'three';
import { formatSceneDistance } from './format.js';

/**
 * Name labels next to the galaxies, in HTML (crisp at any resolution, no
 * texture to rebuild). Shown only where they help: the selected galaxy, the
 * one aimed at in exploration mode, and — with labels switched on (L) —
 * every galaxy that is not right in front of the camera. Never over the
 * galaxy being observed up close.
 */
export function createLabels({ systems }) {
  const layer = document.getElementById('labels');
  const projected = new THREE.Vector3();
  const entries = systems.map((system) => {
    const node = document.createElement('div');
    node.className = 'galaxy-label';
    node.innerHTML = '<span class="galaxy-label__name"></span><span class="galaxy-label__meta"></span>';
    node.querySelector('.galaxy-label__name').textContent = system.entry.name;
    node.style.setProperty('--galaxy-color', system.entry.color);
    node.hidden = true;
    layer.append(node);
    return { system, node, meta: node.querySelector('.galaxy-label__meta'), shown: false, text: '' };
  });
  let all = false;

  return {
    get all() {
      return all;
    },
    setAll(value) {
      all = value;
    },
    /**
     * @param {THREE.PerspectiveCamera} camera
     * @param {{ selected, aimed, focus, width, height }} state
     */
    update(camera, { selected, aimed, focus, width, height }) {
      for (const entry of entries) {
        const { system, node } = entry;
        const distance = camera.position.distanceTo(system.center);
        const relative = distance / system.radius;
        const close = system === focus && relative < 6;
        const wanted = !close && (system === selected || system === aimed || (all && relative > 2.5));
        projected.copy(system.center).project(camera);
        const onScreen = projected.z < 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1;
        const show = wanted && onScreen;
        if (show !== entry.shown) {
          node.hidden = !show;
          entry.shown = show;
        }
        if (!show) continue;
        // Below the galaxy's apparent core, so the label never covers it.
        const pixelsPerUnit = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
        const drop = Math.min((system.radius * 0.35 * pixelsPerUnit) / distance, height * 0.3) + 10;
        const x = ((projected.x + 1) / 2) * width;
        const y = ((1 - projected.y) / 2) * height + drop;
        node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translateX(-50%)`;
        node.classList.toggle('is-selected', system === selected);
        const text = formatSceneDistance(distance);
        if (text !== entry.text) {
          entry.meta.textContent = text;
          entry.text = text;
        }
      }
    },
  };
}

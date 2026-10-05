import { formatSceneDistance } from './format.js';

/**
 * "Galáxias" panel (G) and the information card of the selected galaxy.
 *
 * The list shows every galaxy of the catalog; choosing one selects it
 * (highlight, card, label) and offers the trip — it never teleports the
 * camera. The card separates what is known (type, constellation, real
 * distance, sources) from what belongs to the visualisation (distance in
 * the compressed scene).
 */
export function createGalaxyPanel({ systems, onSelect, onTravel, onObserve }) {
  const panel = document.getElementById('galaxy-panel');
  const toggle = document.getElementById('galaxy-toggle');
  const list = document.getElementById('galaxy-list');
  const card = document.getElementById('info-card');
  const el = (id) => document.getElementById(id);
  const items = new Map();

  for (const system of systems) {
    const entry = system.entry;
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'galaxy-list__item';
    button.dataset.id = entry.id;
    button.innerHTML = `
      <span class="galaxy-list__dot" aria-hidden="true"></span>
      <span class="galaxy-list__text">
        <span class="galaxy-list__name"></span>
        <span class="galaxy-list__meta"></span>
      </span>`;
    button.querySelector('.galaxy-list__dot').style.background = entry.color;
    button.querySelector('.galaxy-list__name').textContent = entry.name;
    button.querySelector('.galaxy-list__meta').textContent =
      `${entry.classification} · ${entry.distance.label.replace('milhões de anos-luz', 'mi a.l.')}`;
    button.addEventListener('click', () => onSelect(system));
    item.append(button);
    list.append(item);
    items.set(system, button);
  }

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }
  toggle.addEventListener('click', () => setOpen(panel.hidden));
  el('galaxy-panel-close').addEventListener('click', () => setOpen(false));

  let selected = null;
  el('info-travel').addEventListener('click', () => selected && onTravel(selected));
  el('info-observe').addEventListener('click', () => selected && onObserve(selected));
  el('info-close').addEventListener('click', () => onSelect(null));

  return {
    setOpen,
    get open() {
      return !panel.hidden;
    },
    toggle() {
      setOpen(panel.hidden);
    },

    /** Shows the card of `system` (null hides it). */
    select(system) {
      selected = system;
      for (const [s, button] of items) button.setAttribute('aria-current', String(s === system));
      card.hidden = !system;
      if (!system) return;
      const entry = system.entry;
      card.style.setProperty('--galaxy-color', entry.color);
      el('info-name').textContent = entry.name;
      el('info-alt').textContent = entry.altNames;
      el('info-type').textContent = entry.classification;
      el('info-constellation').textContent = entry.constellation;
      el('info-distance').textContent = entry.distance.label;
      el('info-distance-note').textContent = entry.distance.estimate ? entry.distance.note : 'medida publicada pela fonte abaixo';
      el('info-size-row').hidden = !entry.size;
      el('info-size').textContent = entry.size ?? '';
      el('info-description').textContent = entry.description;
      const sources = el('info-sources');
      sources.replaceChildren(
        ...entry.sources.map((source) => {
          const link = document.createElement('a');
          link.href = source.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = source.label;
          return link;
        }),
      );
    },

    /**
     * Live part of the card: distance in the scene, and which actions make sense.
     * @param {{ distance: number, observing: boolean, travelling: boolean }} state
     */
    update({ distance, observing, travelling }) {
      if (!selected) return;
      el('info-scene').textContent = formatSceneDistance(distance);
      el('info-travel').disabled = travelling || (observing && distance < selected.radius * 5);
      el('info-observe').disabled = observing || travelling;
    },
  };
}

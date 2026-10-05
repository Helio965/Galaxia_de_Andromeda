import { formatSceneDistance, formatSpeed, formatStars, formatCount } from './format.js';

/**
 * Main HUD: "GALAXY EXPLORER", the galaxy in view, its real distance, the
 * camera's distance and speed in the scene, and the live diagnostics (GPU,
 * frame rate, quality profile, stars drawn). With an integrated GPU or the
 * CPU, a small card explains how to switch to the dedicated graphics card.
 */

const HELP_DISMISSED_KEY = 'galaxy-explorer:gpu-help-dismissed';

export function createHud(gpu, quality) {
  const el = (id) => document.getElementById(id);
  const gpuRow = el('gpu-status');
  const fps = el('fps-value');
  const profile = el('profile-value');
  const stars = el('stars-value');
  const galaxy = el('galaxy-value');
  const realDistance = el('distance-value');
  const sceneDistance = el('scene-distance-value');
  const speed = el('speed-value');
  const mode = el('mode-value');
  const help = el('gpu-help');
  const openButton = el('gpu-help-open');

  // "NVIDIA GeForce RTX 3050 Laptop GPU" -> "GeForce RTX 3050 Laptop GPU"
  const shortName = gpu.name.replace(/^NVIDIA (?=GeForce|Quadro|RTX)/, '').trim();
  gpuRow.dataset.kind = gpu.kind;
  gpuRow.title = gpu.raw || gpu.name;
  el('gpu-name').textContent = shortName;

  const profileName = quality.name.toUpperCase();
  let adjusted = false;
  function renderProfile() {
    let text = profileName;
    if (quality.forced) text += adjusted ? ' · reduzido' : ' · fixo';
    else text += adjusted ? ' · ajustado' : ' · auto';
    profile.textContent = text;
  }
  renderProfile();

  const needsHelp = gpu.kind === 'integrated' || gpu.kind === 'software';
  if (needsHelp) {
    help.dataset.kind = gpu.kind;
    for (const node of help.querySelectorAll('.js-gpu-name')) node.textContent = gpu.name;
    if (gpu.kind === 'software') el('gpu-help-title').textContent = 'Ative a aceleração de hardware';

    const setOpen = (open) => {
      help.hidden = !open;
      openButton.hidden = open;
    };
    openButton.addEventListener('click', () => setOpen(true));
    el('gpu-help-close').addEventListener('click', () => {
      setOpen(false);
      remember(HELP_DISMISSED_KEY, gpu.raw);
    });
    for (const button of help.querySelectorAll('[data-copy]')) {
      button.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(button.dataset.copy);
          button.textContent = 'copiado';
        } catch {
          button.textContent = 'copie o texto';
        }
        setTimeout(() => (button.textContent = 'copiar'), 1800);
      });
    }
    // Open it by itself the first time this GPU is seen.
    setOpen(recall(HELP_DISMISSED_KEY) !== gpu.raw);
  }

  const last = {};
  const set = (node, key, text) => {
    if (last[key] === text) return; // no DOM writes when nothing changed
    last[key] = text;
    node.textContent = text;
  };

  return {
    setFps(value, paused) {
      set(fps, 'fps', `${Math.round(value)}${paused ? ' · pausado' : ''}`);
    },
    setStars(count, max) {
      set(stars, 'stars', formatStars(count));
      stars.title = `${formatCount(count)} estrelas desenhadas (${formatCount(max)} na memória)`;
    },
    setMode(text) {
      set(mode, 'mode', text);
    },
    /**
     * @param {object|null} entry catalog entry of the galaxy in view
     * @param {number} distance camera distance to it, in scene units
     */
    setGalaxy(entry, distance) {
      set(galaxy, 'galaxy', entry ? entry.name : '—');
      set(realDistance, 'real', entry ? entry.distance.label.replace('milhões de anos-luz', 'mi a.l.') : '—');
      realDistance.title = entry
        ? `Distância real até a Terra: ${entry.distance.label}${entry.distance.estimate ? ` (${entry.distance.note})` : ''}`
        : '';
      set(sceneDistance, 'scene', entry ? formatSceneDistance(distance) : '—');
    },
    setSpeed(unitsPerSecond) {
      set(speed, 'speed', formatSpeed(unitsPerSecond));
    },
    markAdjusted() {
      adjusted = true;
      renderProfile();
    },
  };
}

// localStorage can be unavailable (private mode, blocked storage): never fail.
function remember(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function recall(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Key hints at the bottom of the screen, per mode; fades after a while. */
export function createHint() {
  const hint = document.getElementById('hint');
  let timer = 0;
  return {
    show(text, duration = 9000) {
      if (!hint) return;
      hint.textContent = text;
      hint.classList.remove('is-hidden');
      clearTimeout(timer);
      if (duration > 0) timer = setTimeout(() => hint.classList.add('is-hidden'), duration);
    },
    hide() {
      hint?.classList.add('is-hidden');
    },
  };
}

export function setLoadingText(text) {
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = text;
}

export function finishLoading() {
  const loading = document.getElementById('loading');
  loading.classList.add('is-done');
  setTimeout(() => (loading.hidden = true), 900);
}

export function showFatal(message) {
  const fallback = document.getElementById('fallback');
  if (message) fallback.textContent = message;
  fallback.hidden = false;
  document.getElementById('loading').hidden = true;
}

/**
 * HUD and controls panel. The markup lives in index.html; this module wires
 * every `[data-setting]` input to a callback and keeps the diagnostics current.
 */

const FORMATTERS = {
  speed: (v) => `${v.toFixed(2)}×`,
  density: (v) => `${Math.round(v * 100)}%`,
  core: (v) => v.toFixed(2),
  arms: (v) => v.toFixed(2),
  dust: (v) => v.toFixed(2),
  bloom: (v) => v.toFixed(2),
  background: (v) => (v === 0 ? 'off' : v.toFixed(2)),
  tilt: (v) => `${v > 0 ? '+' : ''}${v}°`,
  exposure: (v) => v.toFixed(2),
};

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 0 });

export function createControlsPanel({ values, onChange, onResetCamera, onTogglePause }) {
  const toggle = document.getElementById('controls-toggle');
  const panel = document.getElementById('controls');
  const pauseButton = document.getElementById('pause-toggle');
  const inputs = new Map();

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }

  toggle.addEventListener('click', () => setOpen(panel.hidden));
  panel.addEventListener('submit', (event) => event.preventDefault());

  for (const input of panel.querySelectorAll('[data-setting]')) {
    const key = input.dataset.setting;
    const output = panel.querySelector(`[data-output="${key}"]`);
    const isSwitch = input.type === 'checkbox';

    const read = () => (isSwitch ? input.checked : Number(input.value));
    const render = () => {
      if (output) output.textContent = FORMATTERS[key]?.(read()) ?? String(read());
      if (!isSwitch) {
        // Filled part of the track (WebKit/Blink have no ::range-progress).
        const fill = ((input.value - input.min) / (input.max - input.min)) * 100;
        input.style.setProperty('--fill', `${fill}%`);
      }
    };

    if (isSwitch) input.checked = Boolean(values[key]);
    else input.value = String(values[key]);
    render();
    inputs.set(key, { input, render, isSwitch });

    input.addEventListener(isSwitch ? 'change' : 'input', () => {
      render();
      onChange(key, read());
    });
  }

  pauseButton.addEventListener('click', onTogglePause);
  document.getElementById('reset-camera').addEventListener('click', onResetCamera);

  return {
    setOpen,
    get open() {
      return !panel.hidden;
    },
    setPaused(paused) {
      pauseButton.textContent = paused ? 'Continuar' : 'Pausar';
      pauseButton.setAttribute('aria-pressed', String(paused));
    },
    /** Reflects a value changed elsewhere (keyboard shortcut...). */
    setValue(key, value) {
      const entry = inputs.get(key);
      if (!entry) return;
      if (entry.isSwitch) entry.input.checked = Boolean(value);
      else entry.input.value = String(value);
      entry.render();
    },
  };
}

/** Space: pause, R: reset camera, Esc: close the panel. Ignored while typing in a control. */
export function setupKeyboard({ onTogglePause, onResetCamera, panel }) {
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    const inControl = target instanceof HTMLElement && target.closest('input, button, select, textarea');

    if (event.key === 'Escape' && panel.open) {
      panel.setOpen(false);
      document.getElementById('controls-toggle').focus();
      return;
    }
    if (inControl) return;
    if (event.code === 'Space') {
      event.preventDefault();
      onTogglePause();
    } else if (event.key === 'r' || event.key === 'R') {
      onResetCamera();
    }
  });
}

const HELP_DISMISSED_KEY = 'andromeda-galaxy:gpu-help-dismissed';

/**
 * Live diagnostics: which GPU renders the page, the frame rate, the quality
 * profile and how many stars are drawn. With an integrated GPU or the CPU, a
 * small card explains how to switch to the dedicated graphics card.
 */
export function createHud(gpu, quality) {
  const gpuRow = document.getElementById('gpu-status');
  const fps = document.getElementById('fps-value');
  const profile = document.getElementById('profile-value');
  const stars = document.getElementById('stars-value');
  const help = document.getElementById('gpu-help');
  const openButton = document.getElementById('gpu-help-open');

  // "NVIDIA GeForce RTX 3050 Laptop GPU" -> "GeForce RTX 3050 Laptop GPU"
  const shortName = gpu.name.replace(/^NVIDIA (?=GeForce|Quadro|RTX)/, '').trim();
  gpuRow.dataset.kind = gpu.kind;
  gpuRow.title = gpu.raw || gpu.name;
  document.getElementById('gpu-name').textContent = shortName;

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
    for (const el of help.querySelectorAll('.js-gpu-name')) el.textContent = gpu.name;
    if (gpu.kind === 'software') {
      document.getElementById('gpu-help-title').textContent = 'Ative a aceleração de hardware';
    }

    const setOpen = (open) => {
      help.hidden = !open;
      openButton.hidden = open;
    };
    openButton.addEventListener('click', () => setOpen(true));
    document.getElementById('gpu-help-close').addEventListener('click', () => {
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

  return {
    setFps(value, paused) {
      fps.textContent = `${Math.round(value)}${paused ? ' · pausado' : ''}`;
    },
    setStars(count, max) {
      stars.textContent = `≈ ${compact.format(count)}`;
      stars.title = `${count.toLocaleString('pt-BR')} de ${max.toLocaleString('pt-BR')} estrelas da galáxia`;
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

/** Fades the "drag to orbit" hint after the first interaction (or a while). */
export function setupHint(target) {
  const hint = document.getElementById('hint');
  if (!hint) return;
  const hide = () => hint.classList.add('is-hidden');
  target.addEventListener('pointerdown', hide, { once: true });
  target.addEventListener('wheel', hide, { once: true, passive: true });
  setTimeout(hide, 10000);
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

/**
 * Collapsible settings panel. The markup lives in index.html; this module
 * wires every `[data-setting]` input to a callback.
 */

const FORMATTERS = {
  speed: (v) => `${v.toFixed(2)}×`,
  density: (v) => `${Math.round(v * 100)}%`,
  core: (v) => v.toFixed(2),
  arms: (v) => v.toFixed(2),
  dust: (v) => v.toFixed(2),
  bloom: (v) => v.toFixed(2),
  background: (v) => (v === 0 ? 'off' : v.toFixed(2)),
  exposure: (v) => v.toFixed(2),
  streaks: (v) => (v === 0 ? 'off' : v.toFixed(2)),
};

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

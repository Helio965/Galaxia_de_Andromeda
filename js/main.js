import * as THREE from 'three';
import { describeGpu } from './gpu.js';
import { chooseQuality, createFrameRateGovernor } from './quality.js';
import { createUniverse } from './universe/universe.js';
import { createLodManager } from './universe/lodManager.js';
import { createBeacons } from './universe/beacons.js';
import { createSpaceDust } from './universe/spaceDust.js';
import { findGalaxy } from './universe/galaxyCatalog.js';
import { createBackgroundSky } from './backgroundStars.js';
import { createPostProcessing } from './postprocessing.js';
import { createObserver, framingDistance, TELE_FOV } from './navigation/observer.js';
import { createFreeFlight, EXPLORE_FOV } from './navigation/freeFlight.js';
import { createTravel } from './navigation/travel.js';
import { createWorkClock, IMMEDIATE } from './work.js';
import { createHud, createHint, setLoadingText, finishLoading, showFatal } from './ui/hud.js';
import { createControlsPanel } from './ui/controls.js';
import { createGalaxyPanel } from './ui/galaxyPanel.js';
import { createRadar } from './ui/radar.js';
import { createLabels } from './ui/labels.js';
import { createDebugOverlay } from './ui/debug.js';

const canvas = document.getElementById('scene');
const STEERING_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const params = new URLSearchParams(location.search);
const log = (message) => console.info(message);

start().catch((error) => {
  console.error('[GalaxyExplorer] failed to start:', error);
  showFatal('Não foi possível iniciar a cena 3D. Veja o console do navegador (F12) para detalhes.');
});

function createRenderer(target) {
  try {
    const renderer = new THREE.WebGLRenderer({
      canvas: target,
      antialias: false, // everything goes through the composer's own HDR target
      alpha: false,
      depth: false, // nothing in the scene uses the depth buffer (additive light only)
      stencil: false,
      // Ask for the dedicated GPU. It is only a hint: on laptops with two GPUs
      // the operating system decides (see iniciar.bat and the README).
      powerPreference: 'high-performance',
    });
    renderer.setClearColor(0x000000, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.info.autoReset = false; // the composer renders several passes per frame
    return renderer;
  } catch (error) {
    // three.js r170 needs WebGL 2: very old browsers/drivers end up here.
    console.error('[GalaxyExplorer] WebGL 2 initialisation failed:', error);
    showFatal();
    return null;
  }
}

/** ?seed=N changes every procedural seed (same galaxies, other details). */
function readSeedOffset() {
  const value = Number.parseInt(params.get('seed') ?? '', 10);
  return Number.isFinite(value) ? value >>> 0 : 0;
}

const CONTEXT_RELOADS_KEY = 'galaxy-explorer:context-reloads';

/** Automatic reloads after a lost WebGL context during the last minute. */
function recentContextReloads() {
  try {
    const list = JSON.parse(sessionStorage.getItem(CONTEXT_RELOADS_KEY) || '[]');
    return Array.isArray(list) ? list.filter((time) => Date.now() - time < 60000) : [];
  } catch {
    return [];
  }
}

function rememberContextReloads(list) {
  try {
    sessionStorage.setItem(CONTEXT_RELOADS_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable (private mode...): the guard just cannot persist */
  }
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function start() {
  const renderer = createRenderer(canvas);
  if (!renderer) return;

  // --- GPU + quality -------------------------------------------------------------------
  const gpu = describeGpu(renderer);
  const quality = chooseQuality(gpu);
  const hud = createHud(gpu, quality);
  log(`[GalaxyExplorer] GPU: ${gpu.raw || 'unknown'} (${gpu.kind}) -> ${quality.name} profile (${quality.reason})`);

  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const settings = {
    speed: prefersReducedMotion ? 0.4 : 1,
    density: 1,
    core: 1,
    arms: 1,
    dust: 1,
    bloom: 1,
    background: 1,
    exposure: 1,
    streaks: prefersReducedMotion ? 0 : 1,
    autoRotate: !prefersReducedMotion,
  };
  let paused = false;

  setLoadingText('Gerando as galáxias…');
  await nextFrame(); // let the message paint before the heavy work

  // --- Scene -----------------------------------------------------------------------------------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x010208); // deep black, slightly blue
  const camera = new THREE.PerspectiveCamera(TELE_FOV, window.innerWidth / window.innerHeight, 0.01, 30000);

  const maxPointSize = renderer.capabilities.maxPointSize ?? 64;
  const seedOffset = readSeedOffset();
  const universe = createUniverse({ renderer, quality, maxPointSize, seedOffset });
  scene.add(universe.group);
  await universe.prepare((done, total) => setLoadingText(`Gerando as galáxias… ${done}/${total}`));

  const sky = createBackgroundSky({ quality, seed: 224 ^ seedOffset });
  scene.add(sky.group);
  const beacons = createBeacons(universe.systems);
  scene.add(beacons.points);
  const dust = createSpaceDust({ count: quality.name === 'low' ? 500 : 900, seed: 7 ^ seedOffset });
  scene.add(dust.group);

  const post = createPostProcessing({
    renderer,
    scene,
    camera,
    finish: quality.finish,
    volumeScale: quality.volumeScale,
  });

  // --- Navigation --------------------------------------------------------------------------------
  const requested = params.get('galaxy');
  const startEntry = findGalaxy(requested) ?? findGalaxy('m31');
  if (requested && !findGalaxy(requested)) log(`[GalaxyExplorer] ?galaxy=${requested} não existe no catálogo; começando em M31`);
  const startSystem = universe.get(startEntry.id);

  const observer = createObserver({ camera, canvas, autoRotate: settings.autoRotate });
  const flight = createFreeFlight({ camera, canvas });
  const travel = createTravel({ camera, systems: universe.systems });

  const state = {
    mode: 'observe', // 'observe' | 'explore' | 'travel'
    focus: startSystem, // observed galaxy
    selected: null, // galaxy of the information card
    aimed: null, // galaxy under the crosshair (exploration)
    hudHidden: false,
    cinematic: false,
  };

  observer.start(startSystem, { immediate: true });
  observer.home();

  // --- Level of detail ----------------------------------------------------------------------------
  const work = createWorkClock(quality.workBudgetMs);
  const lod = createLodManager({ universe, quality, work, log });
  lod.refreshSteps();

  // --- Settings -------------------------------------------------------------------------------------
  let densityBudget = 1; // lowered by the adaptive quality
  const applySetting = {
    speed: () => {}, // read every frame
    density: () => lod.setDensity(settings.density * densityBudget),
    core: (v) => universe.setCore(v),
    arms: (v) => universe.setArms(v),
    dust: (v) => universe.setDust(v),
    bloom: (v) => post.setBloom(v),
    background: (v) => sky.setBrightness(v),
    exposure: () => {}, // applied every frame, with the eye adaptation
    streaks: (v) => dust.setLevel(v),
    autoRotate: (v) => observer.setAutoRotate(v && !paused),
  };
  for (const [key, apply] of Object.entries(applySetting)) apply(settings[key]);

  // --- Responsiveness -----------------------------------------------------------------------------
  let maxPixelRatio = quality.maxPixelRatio; // lowered at runtime if the device struggles
  let heightPixels = 1;
  const framing = new Map(); // home distance of each galaxy for the current aspect

  function homeDistanceOf(system) {
    let distance = framing.get(system);
    if (distance === undefined) {
      distance = framingDistance(system, camera.aspect);
      framing.set(system, distance);
    }
    return distance;
  }
  // Depth at which a galaxy's stars have their nominal size: its home distance,
  // corrected for the lens so that zooming (which also widens the lens) stays consistent.
  const lensCorrection = () => Math.tan(THREE.MathUtils.degToRad(TELE_FOV / 2)) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const referenceDepth = (system) => homeDistanceOf(system) * lensCorrection();

  function applyViewport() {
    universe.setViewport(heightPixels, post.volumeHeight, camera.fov);
    beacons.setViewport(heightPixels, camera.fov);
  }

  function onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    post.setSize(width, height, pixelRatio);
    heightPixels = Math.max(1, Math.round(height * pixelRatio));
    framing.clear();
    applyViewport();
    sky.setViewport(heightPixels);
    radar.resize();
  }

  // --- Adaptive quality ---------------------------------------------------------------------------
  // First fewer pixels, then fewer volume samples, then fewer stars... Each step
  // waits for the frame rate to settle (see createFrameRateGovernor).
  let stepsScale = 1;
  let budgetScale = 1;
  const downgrades = [
    () => lowerPixelRatio(1.25),
    () => lowerVolumeScale(0.75),
    () => lowerSteps(0.7, 0.4),
    () => lowerBudget(0.72, 0.5),
    () => lowerPixelRatio(1),
    () => lowerVolumeScale(0.5),
    () => (post.finish ? (post.setFinish(false), true) : false),
    () => (sky.setFraction(0.5), true),
    () => lowerBudget(0.7, 0.3),
    () => lowerSteps(0.6, 0.2),
    () => lowerVolumeScale(0.35),
    () => lowerPixelRatio(0.75),
    () => lowerBudget(0.6, 0.15),
  ];
  let nextDowngrade = 0;

  const currentPixelRatio = () => Math.min(window.devicePixelRatio || 1, maxPixelRatio);
  function lowerPixelRatio(limit) {
    if (currentPixelRatio() <= limit + 1e-3) return false;
    maxPixelRatio = limit;
    onResize();
    return true;
  }
  function lowerVolumeScale(limit) {
    if (post.volumeScale <= limit + 1e-3) return false;
    post.setVolumeScale(limit);
    applyViewport();
    return true;
  }
  function lowerSteps(factor, min) {
    if (stepsScale <= min + 1e-3) return false;
    stepsScale = Math.max(min, stepsScale * factor);
    lod.setStepsScale(stepsScale);
    lod.refreshSteps();
    return true;
  }
  function lowerBudget(factor, min) {
    if (budgetScale <= min + 1e-3) return false;
    budgetScale = Math.max(min, budgetScale * factor);
    densityBudget = budgetScale;
    lod.setBudgetScale(budgetScale);
    applySetting.density();
    return true;
  }

  const governor = createFrameRateGovernor({
    emergencyOnly: quality.forced,
    onDowngrade(fps) {
      while (nextDowngrade < downgrades.length) {
        const changed = downgrades[nextDowngrade++]();
        if (changed) {
          hud.markAdjusted();
          log(
            `[GalaxyExplorer] ${fps.toFixed(1)} fps -> pixel ratio ${currentPixelRatio().toFixed(2)}, ` +
              `volume ${Math.round(post.volumeScale * 100)}% (amostras ×${stepsScale.toFixed(2)}), ` +
              `orçamento de estrelas ×${budgetScale.toFixed(2)}`,
          );
          return true;
        }
      }
      return false;
    },
  });

  // --- Interface ------------------------------------------------------------------------------------
  const hint = createHint();
  const radar = createRadar({ systems: universe.systems });
  const labels = createLabels({ systems: universe.systems });
  const debug = params.get('debug') === '1' ? createDebugOverlay() : null;

  const galaxyPanel = createGalaxyPanel({
    systems: universe.systems,
    onSelect: (system) => select(system),
    onTravel: (system) => travelTo(system),
    onObserve: (system) => observe(system),
  });

  function setPaused(value) {
    paused = value;
    panel.setPaused(paused);
    observer.setAutoRotate(settings.autoRotate && !paused);
  }
  const togglePause = () => setPaused(!paused);

  const panel = createControlsPanel({
    values: settings,
    onChange(key, value) {
      settings[key] = value;
      applySetting[key]?.(value);
    },
    onResetCamera: () => resetCamera(),
    onTogglePause: togglePause,
  });

  function select(system) {
    state.selected = system;
    galaxyPanel.select(system);
    if (system) log(`[GalaxyExplorer] Selecionada: ${system.entry.name}`);
  }

  const MODE_NAMES = { observe: 'Observação', explore: 'Exploração', travel: 'Viagem' };
  const modeButtons = document.querySelectorAll('[data-mode]');
  function renderMode() {
    document.body.dataset.mode = state.mode;
    for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
    hud.setMode(MODE_NAMES[state.mode]);
  }

  function observe(system = state.selected ?? universe.nearest(camera.position).system) {
    if (state.mode === 'travel') travel.cancel();
    flight.stop();
    state.mode = 'observe';
    state.focus = system;
    observer.start(system);
    renderMode();
    hint.show('Arraste para orbitar · role para zoom · TAB explorar · G galáxias');
  }

  function explore({ keepVelocity = null } = {}) {
    observer.stop();
    state.mode = 'explore';
    flight.start({ keepVelocity });
    renderMode();
    hint.show('Clique para mirar com o mouse · W A S D Q E mover · Shift acelera · roda: velocidade · Esc solta o cursor', 12000);
  }

  function travelTo(system) {
    if (!system) return;
    observer.stop();
    flight.stop();
    select(system);
    state.mode = 'travel';
    travel.start(system, camera.fov);
    renderMode();
    log(`[GalaxyExplorer] Viagem até ${system.entry.name} (${travel.length.toFixed(0)} u)`);
    hint.show('Viagem automática · qualquer comando de movimento ou Esc cancela', 6000);
  }

  function cancelTravel() {
    if (state.mode !== 'travel') return;
    log(`[GalaxyExplorer] Viagem cancelada (${travel.phase})`);
    const velocity = travel.velocity.clone().multiplyScalar(0.35); // stops smoothly, no jolt
    travel.cancel();
    explore({ keepVelocity: velocity });
  }
  flight.onInput(() => {
    if (state.mode === 'travel') cancelTravel();
  });
  // Dragging or scrolling on the scene during a trip also takes the controls back.
  canvas.addEventListener('pointerdown', () => state.mode === 'travel' && cancelTravel());
  canvas.addEventListener('wheel', () => state.mode === 'travel' && cancelTravel(), { passive: true });

  function resetCamera() {
    if (state.mode !== 'observe') observe(state.focus);
    observer.reset();
  }

  function toggleMode() {
    if (state.mode === 'observe') explore();
    else observe(state.selected ?? (state.mode === 'travel' ? travel.target : null) ?? universe.nearest(camera.position).system);
  }

  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      if (button.dataset.mode !== state.mode) toggleMode();
    });
  }

  // Hide the interface (H) / cinematic mode (C: no interface, slow automatic orbit).
  function applyChrome() {
    document.body.classList.toggle('hud-hidden', state.hudHidden || state.cinematic);
    document.body.classList.toggle('cinematic', state.cinematic);
  }
  function toggleCinematic() {
    state.cinematic = !state.cinematic;
    if (state.cinematic && state.mode === 'observe') observer.setAutoRotate(!paused);
    else observer.setAutoRotate(settings.autoRotate && !paused);
    applyChrome();
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      log(`[GalaxyExplorer] Tela cheia indisponível: ${error.message}`);
    }
  }

  let screenshotRequested = false;
  function saveScreenshot() {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      link.download = `galaxy-explorer-${(state.focus ?? state.selected)?.id ?? 'universo'}-${stamp}.png`;
      link.href = URL.createObjectURL(blob);
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 4000);
    }, 'image/png');
  }

  // Click (without dragging) on a galaxy selects it.
  let press = null;
  canvas.addEventListener('pointerdown', (event) => {
    press = { x: event.clientX, y: event.clientY, time: performance.now() };
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!press) return;
    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    const quick = performance.now() - press.time < 350;
    press = null;
    if (moved > 6 || !quick) return;
    let system;
    if (document.pointerLockElement === canvas) system = state.aimed;
    else {
      const ndcX = (event.clientX / window.innerWidth) * 2 - 1;
      const ndcY = -(event.clientY / window.innerHeight) * 2 + 1;
      system = universe.pick(ndcX, ndcY, camera, window.innerHeight);
    }
    if (system) select(system);
  });

  // --- Keyboard shortcuts ---------------------------------------------------------------------------
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    const inControl = target instanceof HTMLElement && target.closest('input, select, textarea');
    if (inControl && event.key !== 'Escape') return;
    if (target instanceof HTMLElement && target.closest('button') && (event.code === 'Space' || event.key === 'Enter')) return;

    // Any steering key cancels an autopilot trip (the camera then stops smoothly).
    if (state.mode === 'travel' && STEERING_KEYS.has(event.code)) {
      cancelTravel();
      return;
    }

    switch (event.code) {
      case 'Tab':
        event.preventDefault();
        toggleMode();
        break;
      case 'Escape':
        if (state.mode === 'travel') cancelTravel();
        else if (state.cinematic) toggleCinematic();
        else if (galaxyPanel.open) galaxyPanel.setOpen(false);
        else if (panel.open) panel.setOpen(false);
        else if (state.selected) select(null);
        break;
      case 'Space':
        event.preventDefault();
        togglePause();
        break;
      case 'KeyR':
        resetCamera();
        break;
      case 'KeyG':
        galaxyPanel.toggle();
        break;
      case 'KeyT':
        travelTo(state.selected ?? state.aimed);
        break;
      case 'KeyO':
        observe(state.selected ?? undefined);
        break;
      case 'KeyL':
        labels.setAll(!labels.all);
        break;
      case 'KeyM':
        radar.setVisible(!radar.visible);
        break;
      case 'KeyH':
        state.hudHidden = !state.hudHidden;
        applyChrome();
        break;
      case 'KeyC':
        toggleCinematic();
        break;
      case 'KeyF':
        toggleFullscreen();
        break;
      case 'KeyP':
        screenshotRequested = true;
        break;
      default:
        break;
    }
  });

  window.addEventListener('resize', onResize);
  onResize();
  renderMode();

  // The browser (or the driver) can drop the WebGL context: say so instead of
  // freezing, and reload (the procedural maps live only on the GPU). At most
  // twice a minute, so a failing driver cannot trap the page in a reload loop.
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    const recent = recentContextReloads();
    if (recent.length < 2) {
      rememberContextReloads([...recent, Date.now()]);
      showFatal('A placa de vídeo reiniciou o WebGL. Recarregando…');
      setTimeout(() => location.reload(), 1500);
    } else {
      showFatal(
        'A placa de vídeo reiniciou o WebGL várias vezes. Feche outras abas com 3D, ' +
          'atualize o driver de vídeo ou tente com ?quality=low no endereço.',
      );
    }
  });

  // --- Stars of the first galaxy, before the first frame ----------------------------------------------
  // (all at once: nothing is on screen yet, the loading message is showing)
  setLoadingText(`Gerando ${startEntry.name}…`);
  await nextFrame();
  await startSystem.load(quality.galaxyStars, IMMEDIATE);
  const startState = lod.states.get(startSystem);
  startState.fade = 1; // no fade-in at startup: the canvas itself fades in
  startState.fraction = 1;
  camera.updateMatrixWorld();
  lod.update(camera, window.innerHeight, 0, { focus: startSystem });

  // --- Animation loop ---------------------------------------------------------------------------------
  const clock = new THREE.Clock();
  let galaxyTime = 0;
  let skyTime = 0;
  let exposure = 1;
  const fpsMeter = { frames: 0, elapsed: 0, value: 60 };
  const velocity = new THREE.Vector3();
  const lastPosition = camera.position.clone();
  let speed = 0;
  let hudTimer = 0;

  function aimedSystem() {
    // The galaxy closest to the centre of the screen, within its apparent core.
    return universe.pick(0, 0, camera, window.innerHeight);
  }

  function frame() {
    requestAnimationFrame(frame);
    const rawDelta = clock.getDelta();
    if (quality.adaptive) governor.tick(rawDelta);
    renderer.info.reset();

    fpsMeter.frames += 1;
    fpsMeter.elapsed += rawDelta;
    if (fpsMeter.elapsed >= 0.5) {
      fpsMeter.value = fpsMeter.frames / fpsMeter.elapsed;
      hud.setFps(fpsMeter.value, paused);
      fpsMeter.frames = 0;
      fpsMeter.elapsed = 0;
    }

    // Clamp the delta so a background tab does not produce a huge jump.
    const delta = Math.min(rawDelta, 0.1);
    if (!paused) {
      // Integrating the speed (instead of time × speed) keeps the motion smooth when the slider moves.
      galaxyTime += delta * settings.speed;
      skyTime += delta;
    }

    // --- Camera -----------------------------------------------------------------------
    const nearest = universe.nearest(camera.position);
    let fov = camera.fov;
    if (state.mode === 'observe') {
      fov = observer.update(delta);
    } else if (state.mode === 'explore') {
      flight.update(delta, nearest);
      const boost = THREE.MathUtils.smoothstep(flight.boost, 1.5, 9);
      fov = THREE.MathUtils.lerp(camera.fov, EXPLORE_FOV + 7 * boost, 1 - Math.exp(-2.5 * delta));
    } else if (state.mode === 'travel') {
      const step = travel.update(delta);
      fov = step.fov;
      if (step.done) {
        const target = travel.target ?? state.selected;
        log(`[GalaxyExplorer] Chegada: ${target.entry.name}`);
        state.mode = 'observe';
        state.focus = target;
        observer.start(target, { immediate: true });
        renderMode();
      }
    }
    if (Math.abs(fov - camera.fov) > 1e-4) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
      applyViewport();
    }
    camera.updateMatrixWorld();

    if (delta > 0) {
      velocity.subVectors(camera.position, lastPosition).divideScalar(delta);
      speed += (velocity.length() - speed) * (1 - Math.exp(-6 * delta));
    }
    lastPosition.copy(camera.position);

    // --- Level of detail, exposure ---------------------------------------------------------
    const travelling = state.mode === 'travel';
    lod.update(camera, window.innerHeight, delta, {
      priority: travelling ? travel.target : state.mode === 'observe' ? state.focus : null,
      focus: state.focus,
    });

    // Eye adaptation: next to a bright core the exposure comes down a little;
    // a long, fast flight opens it slightly.
    let closest = universe.systems[0];
    for (const system of universe.systems) {
      if (system.relativeDistance(camera.position) < closest.relativeDistance(camera.position)) closest = system;
    }
    const near = closest.relativeDistance(camera.position);
    const fast = THREE.MathUtils.smoothstep(speed, 20, 120);
    const targetExposure = THREE.MathUtils.lerp(0.55, 1, THREE.MathUtils.smoothstep(near, 0.33, 2.9)) * (1 + 0.08 * fast);
    exposure += (targetExposure - exposure) * (1 - Math.exp(-1.2 * delta));
    renderer.toneMappingExposure = settings.exposure * exposure;

    // --- Scene update --------------------------------------------------------------------------
    universe.update(galaxyTime, camera.position, referenceDepth);
    sky.update(skyTime, camera.position);
    state.aimed = state.mode === 'explore' ? aimedSystem() : null;
    beacons.update(camera.position, state.selected ?? state.aimed);
    dust.update(camera.position, velocity);

    post.render(delta);
    if (screenshotRequested) {
      screenshotRequested = false;
      saveScreenshot(); // right after rendering: the drawing buffer still holds the frame
    }

    // --- Interface ---------------------------------------------------------------------------------
    const width = window.innerWidth;
    const height = window.innerHeight;
    labels.update(camera, { selected: state.selected, aimed: state.aimed, focus: state.focus, width, height });
    radar.draw(camera, state.selected, state.focus);
    hudTimer += rawDelta;
    if (hudTimer > 0.2) {
      hudTimer = 0;
      const shown = state.mode === 'observe' ? state.focus : nearest.system;
      hud.setGalaxy(shown.entry, camera.position.distanceTo(shown.center));
      hud.setSpeed(speed);
      hud.setStars(universe.starCount, universe.systems.reduce((sum, s) => sum + s.maxStarCount, 0));
      if (state.selected) {
        galaxyPanel.update({
          distance: camera.position.distanceTo(state.selected.center),
          observing: state.mode === 'observe' && state.focus === state.selected,
          travelling,
        });
      }
      document.getElementById('travel-status').hidden = !travelling;
      if (travelling) {
        document.getElementById('travel-target').textContent = travel.target.entry.name;
        document.getElementById('travel-phase').textContent = `${travel.phase} · ${Math.round(travel.progress * 100)}%`;
      }
    }
    debug?.update(rawDelta, () => ({
      camera,
      mode: state.mode,
      phase: travelling ? travel.phase : null,
      active: (state.mode === 'observe' ? state.focus : nearest.system)?.entry.name,
      speed,
      multiplier: flight.speedMultiplier,
      fps: fpsMeter.value,
      calls: renderer.info.render.calls,
      points: renderer.info.render.points + renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      stars: universe.starCount,
      busy: lod.busy?.entry.name,
      lod: universe.systems.map((system) => {
        const s = lod.states.get(system);
        return { name: system.entry.name, level: s.level, loaded: system.loaded, loading: system.loading, relative: s.relative ?? 0, fade: s.fade };
      }),
    }));
  }

  // Compile every shader before the first frame, in parallel where the
  // browser supports it (KHR_parallel_shader_compile), so the page never freezes.
  setLoadingText('Preparando os shaders…');
  if (renderer.extensions.has('KHR_parallel_shader_compile')) {
    await renderer.compileAsync(scene, camera);
  } else {
    renderer.compile(scene, camera);
  }

  frame();
  canvas.classList.add('is-ready');
  finishLoading();
  hint.show('Arraste para orbitar · role para zoom · TAB explorar · G galáxias · T viajar');

  // Handy for debugging from the console (and for automated tests).
  window.galaxyExplorer = {
    renderer,
    scene,
    camera,
    universe,
    lod,
    observer,
    flight,
    travel,
    sky,
    post,
    settings,
    quality,
    gpu,
    state,
    select,
    observe,
    explore,
    travelTo,
    cancelTravel,
    toggleMode,
  };
}


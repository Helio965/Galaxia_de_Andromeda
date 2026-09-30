import * as THREE from 'three';
import { describeGpu } from './gpu.js';
import { chooseQuality, createFrameRateGovernor } from './quality.js';
import { createCameraRig, homeDistance, autoExposure, TELE_FOV } from './camera.js';
import { createGalaxy } from './galaxy.js';
import { createBackgroundSky } from './backgroundStars.js';
import { createPostProcessing } from './postprocessing.js';
import {
  createHud,
  createControlsPanel,
  setupKeyboard,
  setupHint,
  finishLoading,
  showFatal,
} from './ui.js';
import { MODEL } from './config.js';

const canvas = document.getElementById('scene');

start().catch((error) => {
  console.error('[andromeda] failed to start:', error);
  showFatal('Não foi possível iniciar a cena 3D. Veja o console do navegador (F12) para detalhes.');
});

function createRenderer(target) {
  try {
    const renderer = new THREE.WebGLRenderer({
      canvas: target,
      antialias: false, // everything goes through the composer's own HDR target
      alpha: false,
      depth: false, // nothing in the scene uses the depth buffer
      stencil: false,
      // Ask for the dedicated GPU. It is only a hint: on laptops with two GPUs
      // the operating system decides (see iniciar.bat and the README).
      powerPreference: 'high-performance',
    });
    renderer.setClearColor(0x000000, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    return renderer;
  } catch (error) {
    // three.js r170 needs WebGL 2: very old browsers/drivers end up here.
    console.error('[andromeda] WebGL 2 initialisation failed:', error);
    showFatal();
    return null;
  }
}

function readSeed() {
  const value = Number.parseInt(new URLSearchParams(location.search).get('seed') ?? '', 10);
  return Number.isFinite(value) ? value >>> 0 : MODEL.seed;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function start() {
  const renderer = createRenderer(canvas);
  if (!renderer) return;

  // --- GPU + quality -----------------------------------------------------------------
  const gpu = describeGpu(renderer);
  const quality = chooseQuality(gpu);
  const hud = createHud(gpu, quality);
  console.info(`[andromeda] GPU: ${gpu.raw || 'unknown'} (${gpu.kind}) -> ${quality.name} profile (${quality.reason})`);

  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const settings = {
    speed: prefersReducedMotion ? 0.4 : 1,
    density: 1,
    core: 1,
    arms: 1,
    dust: 1,
    bloom: 1,
    background: 1,
    tilt: 0,
    exposure: 1,
    autoRotate: !prefersReducedMotion,
  };
  let paused = false;

  // Let the "generating" message paint before the heavy work.
  await nextFrame();

  // --- Scene --------------------------------------------------------------------------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x010208); // deep black, slightly blue

  const rig = createCameraRig({
    canvas,
    aspect: window.innerWidth / window.innerHeight,
    autoRotate: settings.autoRotate,
  });
  const { camera } = rig;

  const seed = readSeed();
  const galaxy = await createGalaxy({ renderer, quality, seed });
  scene.add(galaxy.group);

  const sky = createBackgroundSky({ quality, seed });
  scene.add(sky.group);

  const post = createPostProcessing({
    renderer,
    scene,
    camera,
    finish: quality.finish,
    volumeScale: quality.volumeScale,
  });

  // --- Settings -------------------------------------------------------------------------
  let densityBudget = 1; // lowered by the adaptive quality
  const applySetting = {
    speed: () => {}, // read every frame
    density: () => applyDensity(),
    core: (v) => galaxy.setCore(v),
    arms: (v) => galaxy.setArms(v),
    dust: (v) => galaxy.setDust(v),
    bloom: (v) => post.setBloom(v),
    background: (v) => sky.setBrightness(v),
    tilt: () => {}, // applied every frame together with the roll
    exposure: () => {}, // applied every frame, with the eye adaptation
    autoRotate: (v) => rig.setAutoRotate(v && !paused),
  };
  function applyDensity() {
    galaxy.setDensity(settings.density * densityBudget);
    hud.setStars(galaxy.starCount, galaxy.maxStarCount);
  }
  for (const [key, apply] of Object.entries(applySetting)) apply(settings[key]);

  // --- Responsiveness ----------------------------------------------------------------------
  let maxPixelRatio = quality.maxPixelRatio; // lowered at runtime if the device struggles
  let heightPixels = 1;
  let homeDepth = homeDistance(camera.aspect, rig.roll);
  // Depth at which stars have their nominal size: the home distance, corrected
  // for the lens so that zooming (which also widens the lens) stays consistent.
  const referenceDepth = () =>
    homeDepth *
    (Math.tan(THREE.MathUtils.degToRad(TELE_FOV / 2)) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));

  function onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);

    rig.setAspect(width / height);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    post.setSize(width, height, pixelRatio);

    heightPixels = Math.max(1, Math.round(height * pixelRatio));
    galaxy.setViewport(heightPixels, post.volumeHeight, camera.fov);
    sky.setViewport(heightPixels);
    homeDepth = homeDistance(camera.aspect, rig.roll);
  }
  window.addEventListener('resize', onResize);
  onResize();

  // --- Adaptive quality ------------------------------------------------------------------------
  // First fewer pixels, then fewer volume samples, then fewer stars... Each step
  // waits for the frame rate to settle (see createFrameRateGovernor).
  const downgrades = [
    () => lowerPixelRatio(1.25),
    () => lowerVolumeScale(0.75),
    () => lowerVolume(0.7, 12),
    () => lowerDensity(0.72, 0.5),
    () => lowerPixelRatio(1),
    () => lowerVolumeScale(0.5),
    () => (post.finish ? (post.setFinish(false), true) : false),
    () => (sky.setFraction(0.5), true),
    () => lowerDensity(0.7, 0.3),
    () => lowerVolume(0.6, 6),
    () => lowerVolumeScale(0.35),
    () => lowerPixelRatio(0.75),
    () => lowerDensity(0.6, 0.15),
  ];
  let nextDowngrade = 0;

  function currentPixelRatio() {
    return Math.min(window.devicePixelRatio || 1, maxPixelRatio);
  }
  function lowerPixelRatio(limit) {
    if (currentPixelRatio() <= limit + 1e-3) return false;
    maxPixelRatio = limit;
    onResize();
    return true;
  }
  function lowerVolumeScale(limit) {
    if (post.volumeScale <= limit + 1e-3) return false;
    post.setVolumeScale(limit);
    galaxy.setViewport(heightPixels, post.volumeHeight, camera.fov);
    return true;
  }
  function lowerVolume(factor, min) {
    const steps = galaxy.light.steps;
    if (steps <= min) return false;
    galaxy.light.setSteps(Math.max(min, steps * factor));
    return true;
  }
  function lowerDensity(factor, min) {
    if (densityBudget <= min + 1e-3) return false;
    densityBudget = Math.max(min, densityBudget * factor);
    applyDensity();
    return true;
  }

  const governor = createFrameRateGovernor({
    emergencyOnly: quality.forced,
    onDowngrade(fps) {
      while (nextDowngrade < downgrades.length) {
        const changed = downgrades[nextDowngrade++]();
        if (changed) {
          hud.markAdjusted();
          console.info(
            `[andromeda] ${fps.toFixed(1)} fps -> pixel ratio ${currentPixelRatio().toFixed(2)}, ` +
              `volume ${Math.round(post.volumeScale * 100)}% × ${galaxy.light.steps} steps, ${galaxy.starCount} stars`,
          );
          return true;
        }
      }
      return false;
    },
  });

  // --- Interface ----------------------------------------------------------------------------------
  function setPaused(value) {
    paused = value;
    panel.setPaused(paused);
    rig.setAutoRotate(settings.autoRotate && !paused);
  }
  const togglePause = () => setPaused(!paused);

  const panel = createControlsPanel({
    values: settings,
    onChange(key, value) {
      settings[key] = value;
      applySetting[key]?.(value);
    },
    onResetCamera: () => rig.reset(),
    onTogglePause: togglePause,
  });
  setupKeyboard({ onTogglePause: togglePause, onResetCamera: () => rig.reset(), panel });
  setupHint(canvas);

  // The browser (or the driver) can drop the WebGL context: say so instead of freezing.
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    showFatal('A placa de vídeo reiniciou o WebGL. Recarregando…');
    setTimeout(() => location.reload(), 1500);
  });

  // --- Animation loop ---------------------------------------------------------------------------------
  const clock = new THREE.Clock();
  let galaxyTime = 0;
  let skyTime = 0;
  const fpsMeter = { frames: 0, elapsed: 0 };
  const tiltRadians = () => THREE.MathUtils.degToRad(settings.tilt);

  function frame() {
    requestAnimationFrame(frame);
    const rawDelta = clock.getDelta();
    if (quality.adaptive) governor.tick(rawDelta);

    fpsMeter.frames += 1;
    fpsMeter.elapsed += rawDelta;
    if (fpsMeter.elapsed >= 0.5) {
      hud.setFps(fpsMeter.frames / fpsMeter.elapsed, paused);
      fpsMeter.frames = 0;
      fpsMeter.elapsed = 0;
    }

    // Clamp the delta so a background tab does not produce a huge jump.
    const delta = Math.min(rawDelta, 0.1);
    if (!paused) {
      // Integrating the speed (instead of time × speed) keeps the motion smooth
      // when the slider moves.
      galaxyTime += delta * settings.speed;
      skyTime += delta;
    }

    if (rig.update(delta)) galaxy.setViewport(heightPixels, post.volumeHeight, camera.fov);
    renderer.toneMappingExposure = settings.exposure * autoExposure(camera.position.length());
    galaxy.setOrientation(rig.roll, tiltRadians());
    galaxy.update(galaxyTime, camera, referenceDepth());
    sky.update(skyTime);

    post.render(delta);
  }

  // Compile every shader before the first frame, in parallel where the
  // browser supports it (KHR_parallel_shader_compile), so the page never freezes.
  if (renderer.extensions.has('KHR_parallel_shader_compile')) {
    await renderer.compileAsync(scene, camera);
  } else {
    renderer.compile(scene, camera);
  }

  frame();
  canvas.classList.add('is-ready');
  finishLoading();

  // Handy for debugging from the console (and for automated tests).
  window.andromeda = { renderer, scene, camera, rig, galaxy, sky, post, settings, quality, gpu };
}

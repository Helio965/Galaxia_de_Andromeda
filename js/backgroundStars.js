import * as THREE from 'three';
import { skyVertex, skyGalaxyFragment } from './shaders/sky.glsl.js';
import { starFragment, highlightFragment } from './shaders/stars.glsl.js';
import { createRandom, gaussian, luminosity, randomDirection } from './random.js';

const INNER = 900; // shells well beyond the galaxy (the camera stays within ~240)
const OUTER = 5000;
// Our galaxy's plane passes ~21° from M31 on the sky: foreground stars are
// denser along it. Normal chosen so the band crosses the sky behind M31.
const MILKY_WAY_NORMAL = new THREE.Vector3(0.35, 0.87, -0.36).normalize();

/**
 * The sky around M31: tens of thousands of stars of our own galaxy (faint,
 * irregular, of slightly different colours and distances), a few hundred
 * bright ones with a halo, and faint background galaxies. Fixed in the world
 * frame: tilting M31 does not tilt the sky.
 */
export function createBackgroundSky({ quality, seed }) {
  const random = createRandom(seed, 6);
  const group = new THREE.Group();
  group.name = 'Sky';

  const shared = {
    uTime: { value: 0 },
    uSizeScale: { value: 1 },
  };

  const stars = createLayer({
    name: 'SkyStars',
    count: quality.background,
    shared,
    fragment: starFragment,
    twinkle: 0.06,
    fill: (i, out) => {
      skyDirection(random, out.position);
      const bright = luminosity(random, 4.2);
      out.star.set(0.9 + 1.0 * random() + 0.6 * bright, 0.06 + 1.1 * bright, skyTemperature(random), random());
    },
  });

  const bright = createLayer({
    name: 'SkyBrightStars',
    count: quality.brightStars,
    shared,
    fragment: highlightFragment,
    spriteScale: 10,
    twinkle: 0.04,
    fill: (i, out) => {
      skyDirection(random, out.position);
      // A dozen truly bright stars, the rest moderate.
      // (Kept below ~3: brighter points make the bloom's low-resolution levels look blocky.)
      const boost = i < 12 ? 1.8 + 1.2 * random() : 0.6 + 1.0 * Math.pow(random(), 2);
      out.star.set(1.6 + 0.9 * random(), boost, skyTemperature(random), random());
    },
  });

  const layers = [stars, bright];
  if (quality.galaxies > 0) {
    const galaxies = createLayer({
      name: 'BackgroundGalaxies',
      count: quality.galaxies,
      shared,
      fragment: skyGalaxyFragment,
      defines: { GALAXY: '' },
      shape: true,
      twinkle: 0,
      fill: (i, out) => {
        randomDirection(random, out.position);
        out.position.multiplyScalar(OUTER * (1.1 + 0.3 * random()));
        out.star.set(2.5 + 5 * Math.pow(random(), 2), 0.05 + 0.12 * random(), 0.35 + 0.3 * random(), random());
        out.shape.set(random() * Math.PI, 0.2 + 0.8 * random());
      },
    });
    layers.push(galaxies);
  }
  for (const layer of layers) group.add(layer.points);

  return {
    group,
    count: layers.reduce((sum, layer) => sum + layer.count, 0),
    setBrightness(value) {
      for (const layer of layers) layer.uniforms.uBrightness.value = value;
      group.visible = value > 0;
    },
    /** Keep only a fraction of the faint stars (adaptive quality). */
    setFraction(value) {
      stars.points.geometry.setDrawRange(0, Math.round(stars.count * THREE.MathUtils.clamp(value, 0.05, 1)));
    },
    setViewport(heightPixels) {
      shared.uSizeScale.value = heightPixels / 1080;
    },
    update(time) {
      shared.uTime.value = time;
    },
  };
}

/** Direction on the sky: isotropic, plus a band along the Milky Way plane and a few clusters. */
function skyDirection(random, out) {
  const u = random();
  if (u < 0.4) {
    // Galactic band: latitude concentrated towards the plane.
    randomDirection(random, out);
    const latitude = out.dot(MILKY_WAY_NORMAL);
    const squeeze = 0.1 + 0.3 * Math.abs(gaussian(random, 2)) * 0.5; // keeps 10-40% of the latitude
    out.addScaledVector(MILKY_WAY_NORMAL, -latitude * (1 - squeeze));
    out.normalize();
  } else {
    randomDirection(random, out);
  }
  // Distances spread logarithmically between the shells: parallax at every depth.
  const distance = INNER * Math.pow(OUTER / INNER, random());
  return out.multiplyScalar(distance);
}

/** Mostly white / pale blue / pale yellow, occasionally orange. */
function skyTemperature(random) {
  const u = random();
  if (u < 0.1) return 0.05 + 0.15 * random(); // orange
  if (u < 0.45) return 0.3 + 0.2 * random(); // pale yellow
  if (u < 0.8) return 0.5 + 0.2 * random(); // white
  return 0.72 + 0.28 * random(); // blue-white
}

function createLayer({ name, count, shared, fragment, fill, defines = {}, spriteScale = 1, twinkle, shape = false }) {
  const positions = new Float32Array(count * 3);
  const stars = new Float32Array(count * 4);
  const shapes = shape ? new Float32Array(count * 2) : null;
  const out = { position: new THREE.Vector3(), star: new THREE.Vector4(), shape: new THREE.Vector2() };

  for (let i = 0; i < count; i++) {
    fill(i, out);
    out.position.toArray(positions, i * 3);
    out.star.toArray(stars, i * 4);
    if (shapes) out.shape.toArray(shapes, i * 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aStar', new THREE.BufferAttribute(stars, 4));
  if (shapes) geometry.setAttribute('aShape', new THREE.BufferAttribute(shapes, 2));

  const uniforms = {
    ...shared,
    uBrightness: { value: 1 },
    uSpriteScale: { value: spriteScale },
    uTwinkle: { value: twinkle },
  };
  const points = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({
      name: `${name}Material`,
      uniforms,
      defines,
      vertexShader: skyVertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  points.name = name;
  points.frustumCulled = false;
  points.renderOrder = -2;
  return { points, uniforms, count };
}

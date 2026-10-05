import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { mapVertex, mapFragment } from '../shaders/map.glsl.js';

const PLACEMENT_SIZE = 512; // resolution of the CPU copy used to place stars

/**
 * Map parameters, grouped as the vec4 uniforms of shaders/map.glsl.js.
 * The defaults draw M31; every other disc galaxy overrides some of them in
 * its catalog entry (universe/galaxyCatalog.js).
 */
export const MAP_DEFAULTS = {
  arms: [2, Math.tan((11 * Math.PI) / 180), 4, 0],
  spur: [0.45, 1.6, 10, 1.9],
  spurPatch: [0.14, -0.1, 0.5, 0],
  youngEnv: [3.5, 6.5, 17.5, 25],
  ring: [10.4, 1.15, 0.85, 0.7],
  ringShape: [0.55, -0.35, 1.1, 0.45],
  segments: [0.15, -0.55, 0.25, 0.3],
  clouds: [0.42, -0.35, 0.6, 0.07],
  cloudGain: [0.4, 0.8, 0, 0],
  knots: [1.25, 0.58, 0.95, 1.5],
  lanes: [0.62, 7, 1, 0],
  inner: [0.75, 0.78, 8, 0.8],
  innerEnv: [2.2, 3.6, 7.5, 10],
  innerBreak: [0.3, -0.45, 0.35, 0],
  dustRing: [9.8, 0.75, 0.85, 0],
  dustEnv: [1.8, 3.8, 16.5, 23],
  dustMix: [0.75, 0.45, 0.2, 0.05],
  diffuseDust: [0.14, 9, 20, 25],
  warp: [0.05, 1.7, 0.32, 0.32],
  mix: [1, 1, 1, 0.22],
  bar: [0, 1, 0, 0],
  barDust: [0, 0.4, 0.25, 0],
  floc: [0, 5, 0.6, 6],
  central: [0, 1, 0, 0],
  deform: [0, 0, 0, 0],
  deformRange: [4, 20, 0, 0],
  oldDisk: [5.2, 27, 0, 0], // set by the galaxy body when the disc is deformed
};

const UNIFORM_NAMES = Object.fromEntries(
  Object.keys(MAP_DEFAULTS).map((key) => [key, `u${key[0].toUpperCase()}${key.slice(1)}`]),
);

/** Defaults overridden by a catalog entry (only the given vec4s change). */
export function mapParameters(overrides = {}) {
  const params = {};
  for (const [key, value] of Object.entries(MAP_DEFAULTS)) {
    params[key] = [...(overrides[key] ?? value)];
  }
  return params;
}

/**
 * In-plane tidal deformation, the same as tidalForward in the shader:
 * twist, stretch along an axis and a one-sided shift, from r0 to r1.
 * Used to place the old disc stars of interacting galaxies where the map
 * (drawn in the deformed space) has their light.
 */
export function tidalForward(params, x, z, out) {
  const [twist, stretch, shift, axis] = params.deform;
  const [r0, r1] = params.deformRange;
  const r = Math.hypot(x, z);
  const t = Math.min(Math.max((r - r0) / (r1 - r0), 0), 1);
  const w = t * t * (3 - 2 * t);
  const c = Math.cos(twist * w);
  const s = Math.sin(twist * w);
  let qx = c * x - s * z;
  let qz = s * x + c * z;
  const ex = Math.cos(axis);
  const ez = Math.sin(axis);
  const along = (qx * ex + qz * ez) * stretch * w;
  qx += ex * along + ex * shift * w * w;
  qz += ez * along + ez * shift * w * w;
  out.x = qx;
  out.z = qz;
  return out;
}

export function hasDeformation(params) {
  const [twist, stretch, shift] = params.deform;
  return twist !== 0 || stretch !== 0 || shift !== 0;
}

/**
 * Renders the procedural map of a disc (dust, young arms, star-forming knots,
 * old disc mottling) on the GPU. The map is the single source of truth: the
 * young stars are born where it has young light, and its dust lanes dim exactly
 * the stars behind them.
 *
 * A galaxy keeps a small copy (texture + CPU copy for star placement) for its
 * whole life, and renders a sharp one only while the camera is close.
 */
export function createMapRenderer(renderer, { params, seed, radius }) {
  const uniforms = {
    uMapRadius: { value: radius },
    // Keep the noise offsets small: float precision drops far from the origin.
    uSeed: { value: new THREE.Vector2(((seed * 12.9898) % 97) + 3.1, ((seed * 78.233) % 89) + 7.7) },
  };
  for (const [key, value] of Object.entries(params)) {
    uniforms[UNIFORM_NAMES[key]] = { value: new THREE.Vector4(...value) };
  }

  const material = new THREE.ShaderMaterial({
    name: 'GalaxyMapGenerator',
    uniforms,
    vertexShader: mapVertex,
    fragmentShader: mapFragment,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new FullScreenQuad(material);

  return {
    /** Mipmapped texture of the given size (the caller disposes the target). */
    render(size) {
      const target = new THREE.WebGLRenderTarget(size, size, {
        type: THREE.UnsignedByteType,
        depthBuffer: false,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
      });
      target.texture.name = 'GalaxyMap';
      draw(renderer, quad, target); // three.js updates the mipmaps afterwards
      return target;
    },
    /** CPU copy for star placement (asynchronous read: no pipeline stall). */
    async readSampler() {
      const target = new THREE.WebGLRenderTarget(PLACEMENT_SIZE, PLACEMENT_SIZE, {
        type: THREE.UnsignedByteType,
        depthBuffer: false,
      });
      draw(renderer, quad, target);
      const pixels = new Uint8Array(PLACEMENT_SIZE * PLACEMENT_SIZE * 4);
      try {
        await renderer.readRenderTargetPixelsAsync(target, 0, 0, PLACEMENT_SIZE, PLACEMENT_SIZE, pixels);
      } catch {
        renderer.readRenderTargetPixels(target, 0, 0, PLACEMENT_SIZE, PLACEMENT_SIZE, pixels);
      }
      target.dispose();
      return createSampler(pixels, PLACEMENT_SIZE, radius);
    },
    dispose() {
      quad.dispose();
      material.dispose();
    },
  };
}

function draw(renderer, quad, target) {
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  quad.render(renderer);
  renderer.setRenderTarget(previous);
}

/** 1×1 black map for galaxies without a disc (ellipticals). */
export function createEmptyMap() {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Bilinear lookups into the CPU copy of the map, in pattern-frame kpc.
 * Rows come back from WebGL bottom-up, which matches uv.y = 0 at z = -radius.
 */
function createSampler(pixels, size, radius) {
  const scale = size / (2 * radius);

  function texel(i, j, channel) {
    i = Math.min(Math.max(i, 0), size - 1);
    j = Math.min(Math.max(j, 0), size - 1);
    return pixels[(j * size + i) * 4 + channel];
  }

  function bilinear(fx, fy, channel) {
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const a = texel(i, j, channel) + (texel(i + 1, j, channel) - texel(i, j, channel)) * tx;
    const b = texel(i, j + 1, channel) + (texel(i + 1, j + 1, channel) - texel(i, j + 1, channel)) * tx;
    return (a + (b - a) * ty) / 255;
  }

  return {
    radius,
    young(x, z) {
      return bilinear((x + radius) * scale - 0.5, (z + radius) * scale - 0.5, 1);
    },
    knots(x, z) {
      return bilinear((x + radius) * scale - 0.5, (z + radius) * scale - 0.5, 2);
    },
    dust(x, z) {
      return bilinear((x + radius) * scale - 0.5, (z + radius) * scale - 0.5, 0);
    },
  };
}

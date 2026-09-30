import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { mapVertex, mapFragment } from './shaders/map.glsl.js';
import { MODEL } from './config.js';

const PLACEMENT_SIZE = 512; // resolution of the CPU copy used to place stars

/**
 * Renders the procedural map of the disc (dust, young arms, star-forming knots,
 * old disc mottling) once on the GPU, into a mipmapped texture used by every
 * shader, plus a small copy read back to the CPU to place the stars.
 *
 * The map is the single source of truth: the blue stars are born where the map
 * has young light, and the dust lanes dim exactly the stars behind them.
 */
export async function createGalaxyMap(renderer, { size, seed }) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMapRadius: { value: MODEL.mapRadius },
      uTanPitch: { value: MODEL.tanPitch },
      // Keep the noise offsets small: float precision drops far from the origin.
      uSeed: { value: new THREE.Vector2(((seed * 12.9898) % 97) + 3.1, ((seed * 78.233) % 89) + 7.7) },
    },
    vertexShader: mapVertex,
    fragmentShader: mapFragment,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new FullScreenQuad(material);

  const texture = renderInto(renderer, quad, size, true);

  // Small CPU copy for star placement.
  const placementTarget = new THREE.WebGLRenderTarget(PLACEMENT_SIZE, PLACEMENT_SIZE, {
    type: THREE.UnsignedByteType,
    depthBuffer: false,
  });
  draw(renderer, quad, placementTarget);
  const pixels = new Uint8Array(PLACEMENT_SIZE * PLACEMENT_SIZE * 4);
  try {
    // Asynchronous read (pixel buffer + fence): no pipeline stall.
    await renderer.readRenderTargetPixelsAsync(placementTarget, 0, 0, PLACEMENT_SIZE, PLACEMENT_SIZE, pixels);
  } catch {
    renderer.readRenderTargetPixels(placementTarget, 0, 0, PLACEMENT_SIZE, PLACEMENT_SIZE, pixels);
  }
  placementTarget.dispose();

  quad.dispose();
  material.dispose();

  return {
    texture: texture.texture,
    target: texture,
    sampler: createSampler(pixels, PLACEMENT_SIZE, MODEL.mapRadius),
    dispose() {
      texture.dispose();
    },
  };
}

function renderInto(renderer, quad, size, mipmaps) {
  const target = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    generateMipmaps: mipmaps,
    minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  });
  target.texture.name = 'GalaxyMap';
  draw(renderer, quad, target);
  return target;
}

function draw(renderer, quad, target) {
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  quad.render(renderer); // three.js updates the mipmaps of the target afterwards
  renderer.setRenderTarget(previous);
}

/**
 * Bilinear lookups into the CPU copy of the map, in pattern-frame kpc.
 * Rows come back from WebGL bottom-up, which matches uv.y = 0 at z = -radius.
 */
function createSampler(pixels, size, radius) {
  const scale = size / (2 * radius);
  const out = { dust: 0, young: 0, knots: 0, mottle: 0 };

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
    /** @returns {{dust:number, young:number, knots:number, mottle:number}} (reused object) */
    sample(x, z) {
      const fx = (x + radius) * scale - 0.5;
      const fy = (z + radius) * scale - 0.5;
      out.dust = bilinear(fx, fy, 0);
      out.young = bilinear(fx, fy, 1);
      out.knots = bilinear(fx, fy, 2);
      out.mottle = bilinear(fx, fy, 3);
      return out;
    },
    young(x, z) {
      return bilinear((x + radius) * scale - 0.5, (z + radius) * scale - 0.5, 1);
    },
    knots(x, z) {
      return bilinear((x + radius) * scale - 0.5, (z + radius) * scale - 0.5, 2);
    },
  };
}

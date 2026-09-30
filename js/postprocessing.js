import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** Objects on this layer (the diffuse light volume) are drawn by VolumePass. */
export const VOLUME_LAYER = 1;

// Only HDR values above the threshold glow: the nucleus, bright stars and the
// densest star clouds. Weights favour the small blur levels: a tight glow
// instead of a haze over the whole screen.
const BLOOM = { strength: 0.62, radius: 0.32, threshold: 0.92 };
const BLOOM_FACTORS = [1.0, 0.72, 0.42, 0.2, 0.08];

const finishFragment = /* glsl */ `
  precision highp float;

  uniform sampler2D tDiffuse;
  uniform float uVignette;
  uniform float uFrame;

  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>

  varying vec2 vUv;

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    gl_FragColor = texture2D(tDiffuse, vUv);

    // Soft optical vignette.
    vec2 d = vUv - 0.5;
    gl_FragColor.rgb *= 1.0 - uVignette * smoothstep(0.1, 0.55, dot(d, d) * 1.6);

    #ifdef LINEAR_TONE_MAPPING
      gl_FragColor.rgb = LinearToneMapping(gl_FragColor.rgb);
    #elif defined(REINHARD_TONE_MAPPING)
      gl_FragColor.rgb = ReinhardToneMapping(gl_FragColor.rgb);
    #elif defined(CINEON_TONE_MAPPING)
      gl_FragColor.rgb = CineonToneMapping(gl_FragColor.rgb);
    #elif defined(ACES_FILMIC_TONE_MAPPING)
      gl_FragColor.rgb = ACESFilmicToneMapping(gl_FragColor.rgb);
    #elif defined(AGX_TONE_MAPPING)
      gl_FragColor.rgb = AgXToneMapping(gl_FragColor.rgb);
    #elif defined(NEUTRAL_TONE_MAPPING)
      gl_FragColor.rgb = NeutralToneMapping(gl_FragColor.rgb);
    #endif

    #ifdef SRGB_TRANSFER
      gl_FragColor = sRGBTransferOETF(gl_FragColor);
    #endif

    // ±0.5/255 triangular-ish dither after quantisation-relevant conversion.
    float noise = hash(gl_FragCoord.xy + uFrame * 17.0) + hash(gl_FragCoord.yx * 1.37 + uFrame * 5.0) - 1.0;
    gl_FragColor.rgb += noise / 255.0;
  }
`;

/** OutputPass + vignette + dithering, in the same full-screen draw. */
class FinishPass extends OutputPass {
  constructor() {
    super();
    this.uniforms.uVignette = { value: 0.28 };
    this.uniforms.uFrame = { value: 0 };
    this.material.fragmentShader = finishFragment;
    this.material.needsUpdate = true;
  }
}

/**
 * Draws the diffuse light volume into its own HDR buffer, at a resolution tied
 * to CSS pixels (not device pixels), then adds it onto the scene. The volume is
 * the costliest part of the frame and entirely smooth: on a 4K or retina
 * screen it does not need 4× the samples. Bilinear upsampling hides the change.
 */
class VolumePass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
    this.scale = 1; // fraction of the CSS resolution
    this.pixelRatio = 1;
    this.size = new THREE.Vector2(1, 1);
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.target.texture.name = 'DiffuseLightBuffer';
    this.quad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        name: 'DiffuseLightComposite',
        uniforms: { tDiffuse: { value: this.target.texture } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        // Alpha forced to 1: additive blending multiplies by it, and the buffer's
        // alpha accumulated > 1 while the volume was drawn.
        fragmentShader:
          'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb, 1.0); }',
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }),
    );
  }

  /** Width and height in device pixels (what EffectComposer passes). */
  setSize(width, height) {
    this.size.set(width, height);
    const factor = this.scale / this.pixelRatio;
    this.target.setSize(Math.max(1, Math.round(width * factor)), Math.max(1, Math.round(height * factor)));
  }

  get height() {
    return this.target.height;
  }

  render(renderer, writeBuffer, readBuffer) {
    const mask = this.camera.layers.mask;
    const background = this.scene.background;
    const autoClear = renderer.autoClear;
    this.camera.layers.set(VOLUME_LAYER);
    this.scene.background = null;
    renderer.autoClear = false;

    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(this.scene, this.camera);

    // Add it onto the scene rendered by the previous pass (without clearing it).
    renderer.setRenderTarget(readBuffer);
    this.quad.render(renderer);

    renderer.autoClear = autoClear;
    this.scene.background = background;
    this.camera.layers.mask = mask;
  }

  dispose() {
    this.target.dispose();
    this.quad.material.dispose();
    this.quad.dispose();
  }
}

/**
 * RenderPass (HDR, half float) -> VolumePass -> UnrealBloomPass -> output.
 * Everything is additive light, so the volume can be drawn apart and added.
 * The output pass does the tone mapping + sRGB conversion; on capable
 * profiles it also adds a light vignette and dithering (no banding in the
 * dark gradients of the glow).
 */
export function createPostProcessing({ renderer, scene, camera, finish, volumeScale }) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera)); // everything but the volume (layer 0)

  const volume = new VolumePass(scene, camera);
  volume.scale = volumeScale;
  composer.addPass(volume);

  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  bloom.compositeMaterial.uniforms.bloomFactors.value = BLOOM_FACTORS;
  composer.addPass(bloom);

  const plainOutput = new OutputPass();
  const finishOutput = new FinishPass();
  composer.addPass(plainOutput);
  composer.addPass(finishOutput);
  plainOutput.enabled = !finish;
  finishOutput.enabled = finish;

  return {
    composer,
    bloom,
    get volumeScale() {
      return volume.scale;
    },
    /** Height of the volume buffer in pixels (for its texture level of detail). */
    get volumeHeight() {
      return volume.height;
    },
    setVolumeScale(scale) {
      volume.scale = scale;
      volume.setSize(volume.size.x, volume.size.y);
    },
    get finish() {
      return finishOutput.enabled;
    },
    setFinish(enabled) {
      finishOutput.enabled = enabled;
      plainOutput.enabled = !enabled;
    },
    setBloom(level) {
      bloom.strength = BLOOM.strength * level;
      bloom.enabled = level > 0;
    },
    setSize(width, height, pixelRatio) {
      volume.pixelRatio = pixelRatio;
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
    },
    render(delta) {
      finishOutput.uniforms.uFrame.value = (finishOutput.uniforms.uFrame.value + 1) % 64;
      composer.render(delta);
    },
  };
}

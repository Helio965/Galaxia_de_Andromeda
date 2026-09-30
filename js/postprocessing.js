import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

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
 * RenderPass (HDR, half float) -> UnrealBloomPass -> output.
 * The output pass does the tone mapping + sRGB conversion; on capable
 * profiles it also adds a light vignette and dithering (no banding in the
 * dark gradients of the glow).
 */
export function createPostProcessing({ renderer, scene, camera, finish }) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

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
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
    },
    render(delta) {
      finishOutput.uniforms.uFrame.value = (finishOutput.uniforms.uFrame.value + 1) % 64;
      composer.render(delta);
    },
  };
}

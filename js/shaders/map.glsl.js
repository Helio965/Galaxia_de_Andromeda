import { noiseChunk } from './common.glsl.js';

// ---------------------------------------------------------------------------
// Procedural map of the disc, rendered once into a texture.
//
// It is drawn in the frame of the spiral pattern, face-on, and read by every
// other part of the galaxy: where to place the young stars, how bright the
// diffuse light is, and how much dust there is.
//
//   r: dust            dark lanes on the inner edge of the arms, the 10 kpc
//                      dust ring, tight arcs around the bulge, filaments
//   g: young light     blue arms + the star-forming ring, broken into clumps
//   b: HII knots       star-forming regions (pink) inside the arms
//   a: old disc        slow mottling of the smooth yellow-white disc
//
// Andromeda is not a clean "grand design" spiral: its arms are tightly wound,
// fragmented and dominated by a ring ~10 kpc across. Everything is domain
// warped so no curve looks mathematically perfect.
// ---------------------------------------------------------------------------

export const mapVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const mapFragment = /* glsl */ `
  ${noiseChunk}

  uniform float uMapRadius;
  uniform float uTanPitch;
  uniform vec2 uSeed;

  varying vec2 vUv;

  // Narrow ridge of an m-armed logarithmic spiral: 1 on the arm, 0 between arms.
  float spiral(float phase, float sharpness) {
    return pow(0.5 + 0.5 * cos(phase), sharpness);
  }

  void main() {
    vec2 p = (vUv * 2.0 - 1.0) * uMapRadius; // kpc, pattern frame (x, z)
    float r = length(p);

    // Large-scale warp: the arms wander and bend; a weaker, finer warp roughens
    // their edges. Kept moderate so the arms stay long and legible.
    vec2 warp = vec2(fbm(p * 0.05 + uSeed, 3), fbm(p * 0.05 + uSeed + 41.3, 3));
    vec2 q = p + warp * 1.7;
    vec2 roughness = vec2(snoise(p * 0.32 + uSeed * 1.7), snoise(p * 0.32 + uSeed * 1.7 + 13.1));
    vec2 qa = q + roughness * 0.32;
    float rq = max(length(qa), 0.05);
    float phi = atan(qa.y, qa.x);
    float lr = log(rq);

    // Main pair of arms, a looser pair of spurs, and tighter arcs near the bulge.
    float s1 = 2.0 * (phi - lr / uTanPitch);
    float s2 = 2.0 * (phi - lr / (uTanPitch * 1.6)) + 1.9;
    float s3 = 2.0 * (phi - lr / (uTanPitch * 0.78)) + 0.8;

    // M31's ring of star formation: slightly off-centre and elliptical.
    float ringR = length((p - vec2(0.55, -0.35)) * vec2(1.0, 1.1)) + warp.x * 0.7;
    float ring = exp(-pow((ringR - 10.4) / 1.15, 2.0)) * (0.55 + 0.45 * fbm(q * 0.22 + uSeed + 2.0, 2));

    // ---- young stars ------------------------------------------------------------
    float spurPatches = smoothstep(-0.1, 0.5, fbm(q * 0.14 + uSeed + 9.0, 2));
    float arms = max(spiral(s1, 4.0), spiral(s2, 10.0) * 0.45 * spurPatches);
    float youngEnvelope = smoothstep(3.5, 6.5, r) * (1.0 - smoothstep(17.5, 25.0, r));
    float young = max(arms, ring * 0.85) * youngEnvelope;
    // Arms fade in and out along their length, and gather into star clouds.
    float segments = 0.3 + 0.7 * smoothstep(-0.55, 0.25, fbm(q * 0.15 + uSeed + 5.0, 3));
    float clouds = smoothstep(-0.35, 0.6, fbm(qa * 0.42 + uSeed * 2.0, 3));
    young *= segments * (0.4 + 0.8 * clouds);
    // A little star formation between the arms too.
    young += 0.07 * clouds * youngEnvelope;

    // Star-forming knots: the brightest spots of the star clouds.
    float knotNoise = 0.5 + 0.5 * snoise(qa * 1.25 + uSeed * 3.0);
    float knots = young * pow(smoothstep(0.58, 0.95, knotNoise), 1.5);

    // ---- dust -------------------------------------------------------------------
    // Lanes hug the inner (concave) edge of the arms, plus the dust ring and
    // tight arcs around the bulge. Feathered by ridged noise, broken into patches.
    float lanes = spiral(s1 - 0.62, 7.0);
    float inner = spiral(s3, 8.0) * smoothstep(2.2, 3.6, r) * (1.0 - smoothstep(7.5, 10.0, r));
    // The inner arcs are broken and uneven, not concentric rings.
    inner *= smoothstep(-0.45, 0.35, fbm(qa * 0.3 + uSeed * 6.0, 3));
    float dustRing = exp(-pow((ringR - 9.8) / 0.75, 2.0));
    float dustEnvelope = smoothstep(1.8, 3.8, r) * (1.0 - smoothstep(16.5, 23.0, r));
    float feather = 0.55 + 0.45 * ridged(qa * 0.75 + uSeed * 3.0, 3);
    float patches = 0.25 + 0.75 * smoothstep(-0.5, 0.35, fbm(q * 0.2 + uSeed * 4.0, 3));
    float dust = max(max(lanes, dustRing * 0.85), inner * 0.75) * feather * patches;
    dust = (dust + 0.05 * feather) * dustEnvelope;
    // Thin diffuse dust all over the disc: barely visible face-on, but seen
    // edge-on it draws the dark mid-plane lane of edge-on spirals.
    dust += 0.14 * exp(-r / 9.0) * smoothstep(1.2, 3.5, r) * (1.0 - smoothstep(20.0, 25.0, r)) * patches;

    // ---- old disc ----------------------------------------------------------------
    float mottle = 0.5 + 0.5 * fbm(p * 0.22 + uSeed * 5.0, 3);

    gl_FragColor = clamp(vec4(dust, young, knots, mottle), 0.0, 1.0);
  }
`;

import { noiseChunk } from './common.glsl.js';

// ---------------------------------------------------------------------------
// Procedural map of a galaxy disc, rendered once into a texture.
//
// It is drawn in the frame of the spiral pattern, face-on, and read by every
// other part of the galaxy: where to place the young stars, how bright the
// diffuse light is, and how much dust there is.
//
//   r: dust            lanes on the inner edge of the arms, dust rings, arcs
//                      around the bulge, bar lanes, filaments, diffuse dust
//   g: young light     blue arms, star-forming rings, bar ends, clumps
//   b: HII knots       star-forming regions (pink) inside the young light
//   a: old disc        slow mottling of the smooth yellow-white disc
//
// One shader serves every disc galaxy of the explorer: each one only changes
// the uniforms (see MAP_DEFAULTS in galaxyMap.js). With the defaults it draws
// M31: tightly wound, fragmented arms dominated by a ring ~10 kpc across.
// Bars (NGC 1300, M83), flocculent arms (NGC 4414), a ring with an empty gap
// (Hoag's Object), a dusty central ring (M64) and tidal distortions (Antennae,
// Arp 142, Arp 87) are extra terms switched on by their uniforms.
// ---------------------------------------------------------------------------

export const mapVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// In-plane tidal deformation shared with the CPU (see tidalForward in
// galaxyMap.js): twist, stretch along an axis and a one-sided shift, growing
// from radius r0 to r1. The map is drawn in the deformed space, so each of
// its texels looks up the undeformed point by Newton's method (the mapping is
// smooth and one-to-one, but too sheared for a plain fixed-point iteration).
export const deformChunk = /* glsl */ `
  uniform vec4 uDeform;      // x: twist (rad), y: stretch, z: shift (kpc), w: axis angle
  uniform vec4 uDeformRange; // x: r0, y: r1

  vec2 rotateMap(vec2 v, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
  }

  vec2 tidalForward(vec2 p) {
    float w = smoothstep(uDeformRange.x, uDeformRange.y, length(p));
    vec2 e = vec2(cos(uDeform.w), sin(uDeform.w));
    vec2 q = rotateMap(p, uDeform.x * w);
    q += e * (dot(q, e) * uDeform.y * w);
    q += e * (uDeform.z * w * w);
    return q;
  }

  vec2 tidalInverse(vec2 p) {
    // Start from the untwisted point, then refine (numerical Jacobian).
    vec2 x = rotateMap(p, -uDeform.x * smoothstep(uDeformRange.x, uDeformRange.y, length(p)));
    const float h = 0.02;
    for (int i = 0; i < 10; i++) {
      vec2 f = tidalForward(x) - p;
      vec2 fx = (tidalForward(x + vec2(h, 0.0)) - tidalForward(x - vec2(h, 0.0))) / (2.0 * h);
      vec2 fy = (tidalForward(x + vec2(0.0, h)) - tidalForward(x - vec2(0.0, h))) / (2.0 * h);
      float det = fx.x * fy.y - fy.x * fx.y;
      if (abs(det) < 1e-5) break;
      vec2 step = vec2(fy.y * f.x - fy.x * f.y, -fx.y * f.x + fx.x * f.y) / det;
      float len = length(step);
      x -= len > 3.0 ? step * (3.0 / len) : step; // damped: never jump across the disc
    }
    return x;
  }
`;

export const mapFragment = /* glsl */ `
  ${noiseChunk}
  ${deformChunk}

  uniform float uMapRadius;
  uniform vec2 uSeed;

  uniform vec4 uArms;        // m, tan(pitch), sharpness, phase
  uniform vec4 uSpur;        // strength, pitch multiplier, sharpness, phase
  uniform vec4 uSpurPatch;   // frequency, smoothstep lo, hi
  uniform vec4 uYoungEnv;    // radial envelope of the young light (in0, in1, out0, out1)
  uniform vec4 uRing;        // radius, width, strength, coupling to the warp
  uniform vec4 uRingShape;   // centre offset x, z, aspect (z), noise amount
  uniform vec4 uSegments;    // frequency, lo, hi, floor
  uniform vec4 uClouds;      // frequency, lo, hi, inter-arm level
  uniform vec4 uCloudGain;   // base, gain
  uniform vec4 uKnots;       // frequency, lo, hi, power
  uniform vec4 uLanes;       // offset, sharpness, strength
  uniform vec4 uInner;       // inner arcs: strength, pitch multiplier, sharpness, phase
  uniform vec4 uInnerEnv;
  uniform vec4 uInnerBreak;  // frequency, lo, hi
  uniform vec4 uDustRing;    // radius, width, strength
  uniform vec4 uDustEnv;
  uniform vec4 uDustMix;     // feather frequency, feather amount, patch frequency, floor
  uniform vec4 uDiffuseDust; // amount, scale length, out0, out1
  uniform vec4 uWarp;        // frequency, amplitude, roughness frequency, roughness amplitude
  uniform vec4 uMix;         // dust, young, knots multipliers, mottle frequency
  uniform vec4 uBar;         // length, width, angle, young light at the bar ends
  uniform vec4 uBarDust;     // lanes strength, offset, width, young along the leading edges
  uniform vec4 uFloc;        // flocculent amount, number of fragments, break frequency, sharpness
  uniform vec4 uCentral;     // central dust ring: radius, width, strength, one-sidedness
  uniform vec4 uOldDisk;     // deformed discs only: scale length, radius, enabled

  varying vec2 vUv;

  // Narrow ridge of an m-armed logarithmic spiral: 1 on the arm, 0 between arms.
  float spiral(float phase, float sharpness) {
    return pow(0.5 + 0.5 * cos(phase), sharpness);
  }

  float window(vec4 env, float r) {
    return smoothstep(env.x, env.y, r) * (1.0 - smoothstep(env.z, env.w, r));
  }

  void main() {
    vec2 pd = (vUv * 2.0 - 1.0) * uMapRadius; // kpc, pattern frame (x, z), deformed
    vec2 p = tidalInverse(pd);                // where this point came from
    float r = length(p);

    // Large-scale warp: the arms wander and bend; a weaker, finer warp roughens
    // their edges. Kept moderate so the arms stay long and legible.
    vec2 warp = vec2(fbm(p * uWarp.x + uSeed, 3), fbm(p * uWarp.x + uSeed + 41.3, 3));
    vec2 q = p + warp * uWarp.y;
    vec2 roughness = vec2(snoise(p * uWarp.z + uSeed * 1.7), snoise(p * uWarp.z + uSeed * 1.7 + 13.1));
    vec2 qa = q + roughness * uWarp.w;
    float rq = max(length(qa), 0.05);
    float phi = atan(qa.y, qa.x);
    float lr = log(rq);

    // Main arms, a looser set of spurs, and tighter arcs near the bulge.
    float m = uArms.x;
    float s1 = m * (phi - lr / uArms.y) + uArms.w;
    float s2 = m * (phi - lr / (uArms.y * uSpur.y)) + uSpur.w;
    float s3 = m * (phi - lr / (uArms.y * uInner.y)) + uInner.w;

    // Rings of star formation, possibly off-centre and elliptical.
    float ringR = length((p - uRingShape.xy) * vec2(1.0, uRingShape.z)) + warp.x * uRing.w;
    float ring = exp(-pow((ringR - uRing.x) / uRing.y, 2.0))
               * ((1.0 - uRingShape.w) + uRingShape.w * fbm(q * 0.22 + uSeed + 2.0, 2));

    // ---- young stars ------------------------------------------------------------
    float spurPatches = smoothstep(uSpurPatch.y, uSpurPatch.z, fbm(q * uSpurPatch.x + uSeed + 9.0, 2));
    float arms = m > 0.0 ? max(spiral(s1, uArms.z), spiral(s2, uSpur.z) * uSpur.x * spurPatches) : 0.0;

    // Flocculent discs: many short arm fragments instead of long arms.
    // The phase of the fragments wanders (noise at a third of the break
    // frequency), so they never line up into long regular arms.
    float flocPhase = 0.0;
    if (uFloc.x > 0.0) {
      flocPhase = uFloc.y * (phi - lr / uArms.y) + 6.0 * fbm(q * uFloc.z * 0.3 + uSeed * 7.0, 2);
      float fragments = spiral(flocPhase, uFloc.w)
                      * smoothstep(0.0, 0.45, fbm(qa * uFloc.z + uSeed * 8.0, 3));
      arms = mix(arms, fragments, uFloc.x);
    }

    float youngEnvelope = window(uYoungEnv, r);
    float young = max(arms, ring * uRing.z) * youngEnvelope;
    // Arms fade in and out along their length, and gather into star clouds.
    float segments = uSegments.w + (1.0 - uSegments.w) * smoothstep(uSegments.y, uSegments.z, fbm(q * uSegments.x + uSeed + 5.0, 3));
    float clouds = smoothstep(uClouds.y, uClouds.z, fbm(qa * uClouds.x + uSeed * 2.0, 3));
    young *= segments * (uCloudGain.x + uCloudGain.y * clouds);
    // A little star formation between the arms too.
    young += uClouds.w * clouds * youngEnvelope;

    // Bars: young stars gather at the ends of the bar and along its leading edges.
    vec2 b = rotateMap(p, -uBar.z);
    float barLength = max(uBar.x, 1e-3);
    if (uBar.x > 0.0) {
      float ends = exp(-pow((abs(b.x) - barLength) / (0.3 * barLength), 2.0)) * exp(-pow(b.y / (uBar.y * 1.4), 2.0));
      float edge = exp(-pow((b.y - sign(b.x) * uBarDust.y * 1.6) / (uBarDust.z * 1.5), 2.0))
                 * (1.0 - smoothstep(0.8 * barLength, 1.1 * barLength, abs(b.x)));
      young += (uBar.w * ends + uBarDust.w * edge) * (0.5 + 0.7 * clouds);
    }

    // Star-forming knots: the brightest spots of the star clouds.
    float knotNoise = 0.5 + 0.5 * snoise(qa * uKnots.x + uSeed * 3.0);
    float knots = young * pow(smoothstep(uKnots.y, uKnots.z, knotNoise), uKnots.w);

    // ---- dust -------------------------------------------------------------------
    // Lanes hug the inner (concave) edge of the arms, plus dust rings and tight
    // arcs around the bulge. Feathered by ridged noise, broken into patches.
    float lanes = m > 0.0 ? spiral(s1 - uLanes.x, uLanes.y) * uLanes.z : 0.0;
    if (uFloc.x > 0.0) {
      float laneFragments = spiral(flocPhase - uLanes.x, uFloc.w + 2.0)
                          * smoothstep(-0.1, 0.4, fbm(qa * uFloc.z + uSeed * 9.0, 3));
      lanes = mix(lanes, laneFragments * uLanes.z, uFloc.x);
    }
    float inner = m > 0.0 ? spiral(s3, uInner.z) * window(uInnerEnv, r) : 0.0;
    // The inner arcs are broken and uneven, not concentric rings.
    inner *= smoothstep(uInnerBreak.y, uInnerBreak.z, fbm(qa * uInnerBreak.x + uSeed * 6.0, 3));
    float dustRing = exp(-pow((ringR - uDustRing.x) / uDustRing.y, 2.0));
    float dustEnvelope = window(uDustEnv, r);
    float feather = (1.0 - uDustMix.y) + uDustMix.y * ridged(qa * uDustMix.x + uSeed * 3.0, 3);
    float patches = 0.25 + 0.75 * smoothstep(-0.5, 0.35, fbm(q * uDustMix.z + uSeed * 4.0, 3));
    float dust = max(max(lanes, dustRing * uDustRing.z), inner * uInner.x) * feather * patches;
    dust = (dust + uDustMix.w * feather) * dustEnvelope;

    // Bar dust lanes: straight, offset towards the leading side of each half.
    if (uBar.x > 0.0) {
      float lane = exp(-pow((b.y - sign(b.x) * uBarDust.y) / uBarDust.z, 2.0))
                 * smoothstep(0.08 * barLength, 0.3 * barLength, abs(b.x))
                 * (1.0 - smoothstep(0.85 * barLength, 1.25 * barLength, abs(b.x)));
      dust += uBarDust.x * lane * feather;
    }

    // A dense, lopsided dust ring around the nucleus (the "black eye" of M64).
    if (uCentral.z > 0.0) {
      float side = 1.0 + uCentral.w * cos(phi - 0.6);
      float central = exp(-pow((r - uCentral.x) / uCentral.y, 2.0)) * side;
      dust += uCentral.z * central * (0.6 + 0.6 * feather);
    }

    // Thin diffuse dust all over the disc: barely visible face-on, but seen
    // edge-on it draws the dark mid-plane lane of edge-on spirals.
    dust += uDiffuseDust.x * exp(-r / uDiffuseDust.y) * smoothstep(1.2, 3.5, r)
          * (1.0 - smoothstep(uDiffuseDust.z, uDiffuseDust.w, r)) * patches;

    // ---- old disc ----------------------------------------------------------------
    float mottle = 0.5 + 0.5 * fbm(p * uMix.w + uSeed * 5.0, 3);
    // A deformed disc stores its whole old-disc profile here (the volume
    // cannot afford the inverse deformation at every sample). Square root:
    // more precision in the faint outskirts of an 8-bit channel.
    if (uOldDisk.z > 0.0) {
      float soft = 0.154 * uOldDisk.x;
      float edge = 1.0 - smoothstep(uOldDisk.y * 0.815, uOldDisk.y, r);
      mottle = sqrt((0.72 + 0.5 * mottle) / 1.22 * exp(-sqrt(r * r + soft * soft) / uOldDisk.x) * edge);
    }

    gl_FragColor = clamp(vec4(dust * uMix.x, young * uMix.y, knots * uMix.z, mottle), 0.0, 1.0);
  }
`;

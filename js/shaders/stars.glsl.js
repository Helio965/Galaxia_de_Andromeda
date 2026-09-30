import { gaussChunk, starColorChunk, galaxyMapChunk } from './common.glsl.js';

// ---------------------------------------------------------------------------
// Stars of the galaxy (THREE.Points)
//
// Every population uses this vertex shader; a #define picks how its stars move:
//
//   MOTION_ELLIPSE       old disc: density-wave orbits. Each star follows an
//                        ellipse whose orientation twists with radius; the
//                        pattern of ellipses turns rigidly, the stars move
//                        along them at their own (differential) speed. Arms
//                        appear where the ellipses crowd and never wind up.
//   MOTION_PATTERN       young stars, gas and dust follow the spiral pattern,
//                        which turns rigidly; a small epicycle keeps them alive.
//   MOTION_DIFFERENTIAL  bulge and halo: circular rotation around the axis,
//                        faster inside (rotation curve), scaled down.
//   (none)               satellites: static in the galaxy frame.
//
// The CPU only updates a few uniforms per frame; all motion happens here.
// ---------------------------------------------------------------------------

export const galaxyStarVertex = /* glsl */ `
  ${gaussChunk}
  ${starColorChunk}
  ${galaxyMapChunk}

  uniform float uTime;          // galaxy clock (seconds × speed)
  uniform float uPatternSpeed;  // Ωp, rad per galaxy second (unsigned)
  uniform float uCurveV;
  uniform float uCurveR;
  uniform float uTanPitch;
  uniform float uEllipseOffset;
  uniform float uEccentricity;
  uniform float uMotionScale;   // differential rotation: fraction of the circular speed
  uniform float uSizeScale;     // viewport height / 1080 (stars keep their look at any resolution)
  uniform float uRefDepth;      // depth at which aStar.x is the size in pixels
  uniform float uMinSize;
  uniform float uMaxSize;
  uniform float uBrightness;    // population brightness (settings, density compensation)
  uniform float uSpriteScale;   // highlight / nebula sprites are larger than their core

  // position: the star in the galaxy frame (pattern frame for MOTION_PATTERN).
  //           MOTION_ELLIPSE stores its orbit instead: semi-major axis, phase, height.
  attribute vec4 aStar; // x: size (px at uRefDepth), y: brightness, z: temperature, w: seed

  varying vec3 vColor;
  #if defined(HIGHLIGHT) || defined(NEBULA)
  varying float vCore;
  #endif

  float angularSpeed(float radius) {
    return uCurveV * (1.0 - exp(-radius / uCurveR)) / max(radius, 1e-3);
  }

  void main() {
    vec3 p = position;

    #if defined(MOTION_ELLIPSE)
      float a = position.x;
      float omega = angularSpeed(a);
      float phase = position.y + SPIN * (omega - uPatternSpeed) * uTime;
      float e = uEccentricity * smoothstep(2.0, 5.0, a) * (1.0 - smoothstep(17.0, 24.0, a));
      float orientation = log(a) / uTanPitch + uEllipseOffset + uPatternAngle;
      vec2 q = rotate2(vec2(a * cos(phase), a * (1.0 - e) * sin(phase)), orientation);
      // Slow vertical oscillation through the disc.
      float bob = cos(aStar.w * 6.2831853 + uTime * omega * 1.8);
      p = vec3(q.x, position.z * bob, q.y);
    #elif defined(MOTION_PATTERN)
      float epicycle = aStar.w * 6.2831853 + uTime * (0.03 + 0.05 * aStar.w);
      vec2 xz = position.xz + 0.035 * vec2(cos(epicycle), sin(epicycle));
      xz = rotate2(xz, uPatternAngle);
      p = vec3(xz.x, position.y, xz.y);
    #elif defined(MOTION_DIFFERENTIAL)
      float radius = length(position.xz);
      vec2 xz = rotate2(position.xz, SPIN * angularSpeed(radius) * uMotionScale * uTime);
      p = vec3(xz.x, position.y, xz.y);
    #endif

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    float depth = max(-mv.z, 1e-3);
    // Perceptual perspective: nearer stars are a little larger and brighter,
    // without the full inverse-square law (which would blow up close stars).
    float perspective = clamp(uRefDepth / depth, 0.05, 12.0);
    float size = aStar.x * uSizeScale * pow(perspective, 0.6);
    float flux = aStar.y * pow(perspective, 0.45);

    // Sub-pixel stars are drawn at the minimum size and dimmed instead, so their
    // total light is kept and they do not shimmer.
    float energy = size < uMinSize ? (size * size) / (uMinSize * uMinSize) : 1.0;
    size = max(size, uMinSize);

    #if defined(HIGHLIGHT) || defined(NEBULA)
      float sprite = min(size * uSpriteScale, uMaxSize * 2.0);
      vCore = size / sprite;
      size = sprite;
    #else
      size = min(size, uMaxSize);
    #endif
    gl_PointSize = size;

    // Stars right next to the camera would cover the screen: fade them out.
    float nearFade = smoothstep(0.25, 1.6, depth);

    vec3 color = starColor(aStar.z);
    #ifdef NEBULA
      color = vec3(1.0, 0.42, 0.55); // H-alpha pink, a touch of blue from O[III]/reflection
    #endif

    vec3 dust = dustTransmittance(p);
    vColor = color * (flux * energy * nearFade * uBrightness) * dust;

    // Nothing to draw: move it out of the clip volume (skips rasterisation).
    if (max(vColor.r, max(vColor.g, vColor.b)) < 1e-5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

// Plain star: a small Gaussian spot, additive.
export const starFragment = /* glsl */ `
  varying vec3 vColor;

  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    float glow = exp(-r2 * 4.2);
    gl_FragColor = vec4(vColor * glow, 1.0);
  }
`;

// Bright star: sharp core, faint halo and very discreet diffraction-like spikes.
export const highlightFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vCore; // core radius, as a fraction of the sprite

  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r = length(c);
    if (r > 1.0) discard;
    float core = exp(-pow(r / max(vCore, 1e-3), 2.0) * 4.2);
    float halo = 0.05 * exp(-r * 6.0) + 0.012 * exp(-r * 2.5);
    vec2 a = abs(c);
    float spikes = (exp(-a.y / (0.012 + 0.02 * vCore)) * pow(1.0 - a.x, 3.0)
                  + exp(-a.x / (0.012 + 0.02 * vCore)) * pow(1.0 - a.y, 3.0)) * 0.035;
    float edge = 1.0 - smoothstep(0.7, 1.0, r);
    gl_FragColor = vec4(vColor * (core + (halo + spikes) * edge), 1.0);
  }
`;

// Faint, soft glow of an HII region.
export const nebulaFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vCore;

  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    float glow = exp(-r2 * 3.2) * (1.0 - r2);
    gl_FragColor = vec4(vColor * glow * vCore * vCore, 1.0);
  }
`;

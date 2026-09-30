// GLSL building blocks shared by the galaxy shaders.

// ---------------------------------------------------------------------------
// 2D simplex noise
// Ashima Arts / Stefan Gustavson, MIT License
// https://github.com/ashima/webgl-noise
// ---------------------------------------------------------------------------

export const noiseChunk = /* glsl */ `
  vec3 mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute3(vec3 x) { return mod289v3(((x * 34.0) + 10.0) * x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289v2(i);
    vec3 p = permute3(permute3(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  // Fractal sum of octaves, roughly in [-1, 1].
  float fbm(vec2 p, int octaves) {
    float sum = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 6; i++) {
      if (i >= octaves) break;
      sum += amplitude * snoise(p);
      p = p * 2.03 + vec2(17.13, 9.71);
      amplitude *= 0.5;
    }
    return sum * 1.07;
  }

  // Ridged noise: thin bright crests (filaments), roughly in [0, 1].
  float ridged(vec2 p, int octaves) {
    float sum = 0.0;
    float amplitude = 0.55;
    for (int i = 0; i < 6; i++) {
      if (i >= octaves) break;
      float n = 1.0 - abs(snoise(p));
      sum += amplitude * n * n;
      p = p * 2.11 + vec2(3.71, 1.37);
      amplitude *= 0.5;
    }
    return sum;
  }
`;

// ---------------------------------------------------------------------------
// Integrals of Gaussian profiles along rays.
// The galaxy's diffuse light and its dust are made of Gaussian layers and
// ellipsoids, whose line integrals have closed forms (error function). That
// keeps the volume rendering exact with only a handful of samples.
// ---------------------------------------------------------------------------

export const gaussChunk = /* glsl */ `
  // Error function, max error ~1.5e-4 (Winitzki's approximation).
  float erfApprox(float x) {
    float x2 = x * x;
    float ax2 = 0.147 * x2;
    return sign(x) * sqrt(1.0 - exp(-x2 * (1.27323954 + ax2) / (1.0 + ax2)));
  }

  // Mean of exp(-y² / 2σ²) for y going linearly from y0 to y1.
  float gaussMean(float y0, float y1, float sigma) {
    float dy = y1 - y0;
    if (abs(dy) < 0.5 * sigma) {
      // Short interval: Simpson's rule is exact enough and avoids cancellation.
      float s = 0.5 / (sigma * sigma);
      float ym = 0.5 * (y0 + y1);
      return (exp(-y0 * y0 * s) + 4.0 * exp(-ym * ym * s) + exp(-y1 * y1 * s)) / 6.0;
    }
    float k = 0.70710678 / sigma;
    return 1.25331414 * sigma * (erfApprox(y1 * k) - erfApprox(y0 * k)) / dy;
  }

  // A Gaussian ellipsoid exp(-|x / σ|² / 2) seen along the ray ro + t·rd is a
  // 1D Gaussian in t. Precompute it once per ray, then integrate any interval.
  struct Blob {
    float amplitude; // integral over the whole ray / 2
    float center;    // t of the closest approach
    float k;         // slope inside erf()
  };

  Blob makeBlob(vec3 ro, vec3 rd, vec3 invSigma) {
    vec3 o = ro * invSigma;
    vec3 d = rd * invSigma;
    float dd = dot(d, d);
    float od = dot(o, d);
    float miss2 = max(dot(o, o) - od * od / dd, 0.0);
    float len = sqrt(dd);
    Blob b;
    b.center = -od / dd;
    b.k = 0.70710678 * len;
    b.amplitude = exp(-0.5 * miss2) * 1.25331414 / len;
    return b;
  }

  float blobIntegral(Blob b, float ta, float tb) {
    return b.amplitude * (erfApprox(b.k * (tb - b.center)) - erfApprox(b.k * (ta - b.center)));
  }
`;

// ---------------------------------------------------------------------------
// Star colours: a rough black-body ramp, in linear RGB.
// temperature 0 = cool red (M) .. 1 = hot blue (O/B).
// ---------------------------------------------------------------------------

export const starColorChunk = /* glsl */ `
  vec3 starColor(float t) {
    vec3 c = mix(vec3(1.0, 0.52, 0.30), vec3(1.0, 0.74, 0.50), smoothstep(0.0, 0.22, t)); // M -> K
    c = mix(c, vec3(1.0, 0.88, 0.72), smoothstep(0.18, 0.42, t));  // -> G
    c = mix(c, vec3(1.0, 0.96, 0.9), smoothstep(0.4, 0.58, t));    // -> F
    c = mix(c, vec3(0.84, 0.89, 1.0), smoothstep(0.56, 0.76, t));  // -> A
    c = mix(c, vec3(0.64, 0.75, 1.0), smoothstep(0.74, 1.0, t));   // -> B / O
    return c;
  }
`;

// ---------------------------------------------------------------------------
// Galaxy map + dust extinction
//
// The procedural map (see galaxyMap.js) lives in the frame of the spiral
// pattern, which turns rigidly: rotate into it before sampling.
//   r: dust  g: young arm light  b: star-forming knots  a: old disc mottling
//
// Dust is a thin Gaussian layer around the mid-plane. The light of anything
// behind it is dimmed by exp(-τ), with τ the dust column along the line of
// sight, and reddened (blue light is absorbed more).
// ---------------------------------------------------------------------------

export const galaxyMapChunk = /* glsl */ `
  uniform sampler2D uGalaxyMap;
  uniform float uMapRadius;
  uniform float uPatternAngle;
  uniform float uDustStrength;  // optical depth per kpc at map value 1
  uniform float uDustSigma;
  uniform float uDustMaxColumn; // caps grazing sight lines (kpc)
  uniform vec3 uCamLocal;       // camera position in the galaxy frame

  const vec3 DUST_REDDENING = vec3(0.66, 1.0, 1.45);

  vec2 rotate2(vec2 v, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
  }

  vec2 mapUv(vec2 xz) {
    return rotate2(xz, -uPatternAngle) / (2.0 * uMapRadius) + 0.5;
  }

  vec4 galaxyMap(vec2 xz, float lod) {
    return textureLod(uGalaxyMap, mapUv(xz), lod);
  }

  // Transmission of the dust between a point p and the camera (galaxy frame).
  vec3 dustTransmittance(vec3 p) {
    vec3 d = uCamLocal - p;
    float len = length(d);
    // Column of the Gaussian layer crossed by the segment, in kpc.
    float column = min(len * gaussMean(p.y, uCamLocal.y, uDustSigma), uDustMaxColumn);
    if (column < 1e-4 || uDustStrength <= 0.0) return vec3(1.0);
    // The dust density is read where the sight line crosses the mid-plane.
    float t = abs(d.y) > 1e-4 ? clamp(-p.y / d.y, 0.0, 1.0) : 0.0;
    // Grazing lines of sight stay long inside the layer: look a bit further along.
    float grazing = 1.0 - smoothstep(0.05, 0.3, abs(d.y) / max(len, 1e-4));
    t = mix(t, min(t + 2.5 / max(len, 1e-3), 1.0), grazing);
    float dust = galaxyMap(p.xz + d.xz * t, 1.0).r;
    return exp(-uDustStrength * dust * column * DUST_REDDENING);
  }
`;

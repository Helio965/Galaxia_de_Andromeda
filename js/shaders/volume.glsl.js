import { noiseChunk, gaussChunk, galaxyMapChunk } from './common.glsl.js';

// ---------------------------------------------------------------------------
// Diffuse light of the galaxy (the unresolved glow of billions of stars)
//
// A box around the galaxy is rasterised (back faces, so it also works with
// the camera inside it). For each pixel the ray camera -> box is integrated
// front to back through:
//
//   - the bulge: a sum of Gaussian ellipsoids, integrated exactly (erf);
//   - the disc slab: old yellow-white light, blue arm light and pink HII
//     knots read from the galaxy map, each in its own Gaussian layer;
//   - dust, a thinner Gaussian layer, which absorbs (and reddens) the light
//     of everything behind it, bulge included.
//
// That is what makes the dark lanes stand out in front of the bright bulge on
// the near side of the disc, from any viewing angle.
// ---------------------------------------------------------------------------

export const volumeVertex = /* glsl */ `
  varying vec3 vLocal;

  void main() {
    vLocal = position; // box vertices are already in the galaxy frame
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const volumeFragment = /* glsl */ `
  ${noiseChunk}
  ${gaussChunk}
  ${galaxyMapChunk}

  #ifndef BULGE_COMPONENTS
  #define BULGE_COMPONENTS 4
  #endif
  #ifndef MAX_STEPS
  #define MAX_STEPS 32
  #endif

  uniform int uSteps;
  uniform float uDiskRadius;
  uniform float uDiskScale;
  uniform float uOldSigma;
  uniform float uYoungSigma;
  uniform float uDiskLight;
  uniform float uYoungLight;
  uniform float uHiiLight;
  uniform float uCoreLight;
  uniform float uPixelAngle;    // angular size of a pixel (radians), for texture LOD
  uniform float uTexelSize;     // kpc per texel of the galaxy map
  uniform vec4 uBulgeShape[BULGE_COMPONENTS]; // xyz: 1/σ per axis, w: peak emissivity
  uniform vec3 uBulgeColor[BULGE_COMPONENTS];

  varying vec3 vLocal;

  // Interleaved gradient noise (Jimenez 2014): per-pixel jitter of the samples.
  float ign(vec2 pixel) {
    return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
  }

  // Light of the bulge between ta and tb along the ray.
  vec3 bulgeLight(Blob blobs[BULGE_COMPONENTS], float ta, float tb) {
    vec3 sum = vec3(0.0);
    for (int i = 0; i < BULGE_COMPONENTS; i++) {
      sum += uBulgeColor[i] * (uBulgeShape[i].w * blobIntegral(blobs[i], ta, tb));
    }
    return sum;
  }

  // Colour of the old disc: warm near the bulge, whiter outside.
  vec3 oldDiscColor(float radius) {
    return mix(vec3(1.0, 0.84, 0.62), vec3(0.95, 0.92, 0.88), smoothstep(4.0, 16.0, radius));
  }

  void main() {
    vec3 ro = uCamLocal;
    vec3 rd = normalize(vLocal - uCamLocal);

    Blob blobs[BULGE_COMPONENTS];
    for (int i = 0; i < BULGE_COMPONENTS; i++) blobs[i] = makeBlob(ro, rd, uBulgeShape[i].xyz);

    // --- Where does the ray cross the disc slab? -------------------------------------
    float halfHeight = 3.2 * uOldSigma;
    float tIn = 0.0;
    float tOut = -1.0;
    if (abs(rd.y) > 1e-5) {
      float t1 = (-halfHeight - ro.y) / rd.y;
      float t2 = (halfHeight - ro.y) / rd.y;
      tIn = min(t1, t2);
      tOut = max(t1, t2);
    } else if (abs(ro.y) < halfHeight) {
      tOut = 1e5;
    }
    // ... and the cylinder that contains the disc.
    float a = dot(rd.xz, rd.xz);
    float b = dot(ro.xz, rd.xz);
    float c = dot(ro.xz, ro.xz) - uDiskRadius * uDiskRadius;
    float disc = b * b - a * c;
    if (disc > 0.0 && a > 1e-8) {
      float root = sqrt(disc);
      tIn = max(tIn, (-b - root) / a);
      tOut = min(tOut, (-b + root) / a);
    } else {
      tOut = -1.0;
    }
    tIn = max(tIn, 0.0);

    vec3 light = vec3(0.0);
    vec3 transmittance = vec3(1.0);

    if (tOut <= tIn) {
      // The ray misses the disc: only the bulge.
      light = bulgeLight(blobs, 0.0, 1e5) * uCoreLight;
    } else {
      // Bulge light in front of the disc slab: not dimmed.
      light = bulgeLight(blobs, 0.0, tIn) * uCoreLight;

      float dt = (tOut - tIn) / float(uSteps);
      float jitter = ign(gl_FragCoord.xy);
      // Mip level from the pixel footprint on the disc (textureLod: the loop is not uniform).
      float grazing = max(abs(rd.y), 0.12);

      // erf() of each bulge component at the start of the current step, reused
      // as the end of the previous one. Components the ray passes far from are skipped.
      float erfStart[BULGE_COMPONENTS];
      bool bulgeActive[BULGE_COMPONENTS];
      for (int j = 0; j < BULGE_COMPONENTS; j++) {
        bulgeActive[j] = blobs[j].amplitude * uBulgeShape[j].w > 1e-4;
        erfStart[j] = erfApprox(blobs[j].k * (tIn - blobs[j].center));
      }

      for (int i = 0; i < MAX_STEPS; i++) {
        if (i >= uSteps) break;
        float ta = tIn + dt * float(i);
        float tb = ta + dt;
        vec3 pa = ro + rd * ta;
        vec3 pb = ro + rd * tb;
        vec3 ps = ro + rd * (ta + jitter * dt);

        float footprint = max((ta + jitter * dt) * uPixelAngle / grazing, dt * a * 0.25);
        float lod = log2(max(footprint / uTexelSize, 1.0));
        vec4 map = galaxyMap(ps.xz, lod);
        float radius = length(ps.xz);

        float edge = 1.0 - smoothstep(uDiskRadius - 5.0, uDiskRadius, radius);
        float oldProfile = exp(-sqrt(radius * radius + 0.64) / uDiskScale) * edge;

        float gOld = gaussMean(pa.y, pb.y, uOldSigma);
        float gYoung = gaussMean(pa.y, pb.y, uYoungSigma);
        float gDust = gaussMean(pa.y, pb.y, uDustSigma);

        vec3 emission = oldDiscColor(radius) * (uDiskLight * oldProfile * (0.72 + 0.5 * map.a) * gOld)
                      + vec3(0.4, 0.6, 1.0) * (uYoungLight * map.g * gYoung)
                      + vec3(1.0, 0.36, 0.48) * (uHiiLight * map.b * gYoung);
        vec3 bulge = vec3(0.0);
        for (int j = 0; j < BULGE_COMPONENTS; j++) {
          if (!bulgeActive[j]) continue;
          float erfEnd = erfApprox(blobs[j].k * (tb - blobs[j].center));
          bulge += uBulgeColor[j] * (uBulgeShape[j].w * blobs[j].amplitude * (erfEnd - erfStart[j]));
          erfStart[j] = erfEnd;
        }
        emission = emission * dt + bulge * uCoreLight;

        vec3 tau = uDustStrength * map.r * gDust * dt * DUST_REDDENING;
        // Light emitted inside the step is, on average, behind half of its dust.
        light += transmittance * emission * exp(-0.5 * tau);
        transmittance *= exp(-tau);
      }

      // Bulge light behind the disc: dimmed by all of the dust in between.
      light += transmittance * bulgeLight(blobs, tOut, 1e5) * uCoreLight;
    }

    gl_FragColor = vec4(light, 1.0);
  }
`;

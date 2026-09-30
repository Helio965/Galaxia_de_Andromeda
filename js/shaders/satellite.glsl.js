import { gaussChunk, galaxyMapChunk } from './common.glsl.js';

// ---------------------------------------------------------------------------
// Diffuse glow of a satellite galaxy (M32, M110).
//
// Rasterised as a small box around the satellite (back faces). Its light is a
// sum of two Gaussian ellipsoids integrated exactly along each pixel's ray,
// so it looks right from any angle. If the satellite sits behind M31's disc,
// the disc's dust dims it (computed once per vertex, at its centre).
// ---------------------------------------------------------------------------

export const satelliteVertex = /* glsl */ `
  ${gaussChunk}
  ${galaxyMapChunk}

  uniform vec3 uCenter; // satellite centre in the galaxy frame

  varying vec3 vLocal;
  varying vec3 vDust;

  void main() {
    vLocal = position;
    vDust = dustTransmittance(uCenter);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const satelliteFragment = /* glsl */ `
  ${gaussChunk}

  uniform vec3 uCamera;       // camera position in the satellite frame
  uniform vec4 uCore;         // xyz: 1/σ, w: peak emissivity
  uniform vec4 uEnvelope;
  uniform vec3 uCoreColor;
  uniform vec3 uEnvelopeColor;
  uniform float uIntensity;

  varying vec3 vLocal;
  varying vec3 vDust;

  void main() {
    vec3 rd = normalize(vLocal - uCamera);
    Blob core = makeBlob(uCamera, rd, uCore.xyz);
    Blob envelope = makeBlob(uCamera, rd, uEnvelope.xyz);
    vec3 light = uCoreColor * (uCore.w * blobIntegral(core, 0.0, 1e5))
               + uEnvelopeColor * (uEnvelope.w * blobIntegral(envelope, 0.0, 1e5));
    gl_FragColor = vec4(light * vDust * uIntensity, 1.0);
  }
`;

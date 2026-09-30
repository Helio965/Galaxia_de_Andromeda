import { starColorChunk } from './common.glsl.js';

// ---------------------------------------------------------------------------
// Background sky: stars of our own galaxy and distant galaxies, on shells far
// beyond M31. At a finite distance they shift slightly when the camera orbits
// (parallax), which sells the scale of the scene.
// ---------------------------------------------------------------------------

export const skyVertex = /* glsl */ `
  ${starColorChunk}

  uniform float uTime;
  uniform float uSizeScale;
  uniform float uBrightness;
  uniform float uSpriteScale;
  uniform float uTwinkle;

  attribute vec4 aStar;  // x: size (px @1080p), y: brightness, z: temperature, w: seed
  #ifdef GALAXY
  attribute vec2 aShape; // x: position angle, y: axis ratio
  varying vec2 vShape;
  #endif

  varying vec3 vColor;
  varying float vCore;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;

    float size = aStar.x * uSizeScale;
    float energy = size < 1.2 ? size * size / 1.44 : 1.0;
    size = max(size, 1.2);
    float sprite = size * uSpriteScale;
    vCore = size / sprite;
    gl_PointSize = sprite;

    // Extremely subtle scintillation, each star at its own slow pace.
    float twinkle = 1.0 + uTwinkle * sin(uTime * (0.35 + 1.4 * aStar.w) + aStar.w * 91.0);
    vec3 color = starColor(aStar.z);
    #ifdef GALAXY
      vShape = aShape;
      color = mix(color, vec3(1.0, 0.9, 0.78), 0.4);
      twinkle = 1.0;
    #endif
    vColor = color * aStar.y * energy * twinkle * uBrightness;
  }
`;

// Distant galaxy: a tiny elliptical smudge with a brighter centre.
export const skyGalaxyFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vCore;
  varying vec2 vShape;

  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float s = sin(vShape.x);
    float k = cos(vShape.x);
    vec2 e = vec2(k * c.x - s * c.y, s * c.x + k * c.y);
    e.y /= max(vShape.y, 0.15);
    float r2 = dot(e, e);
    if (r2 > 1.0) discard;
    float glow = exp(-r2 * 5.0) * 0.7 + exp(-r2 * 30.0) * 0.6;
    gl_FragColor = vec4(vColor * glow, 1.0);
  }
`;

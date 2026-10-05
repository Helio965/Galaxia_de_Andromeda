import * as THREE from 'three';

const vertexShader = /* glsl */ `
  attribute vec3 aColor;
  attribute float aRadius;
  attribute float aIntensity;
  uniform float uProjScale;
  varying vec3 vColor;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float depth = max(-mv.z, 1e-3);
    // A compact glow about the size of the galaxy's bright core, never below a few pixels.
    float size = aRadius * 0.35 * uProjScale / depth;
    gl_PointSize = clamp(size, 5.0, 26.0);
    // Below the minimum size the glow keeps its total light (dimmer, not bigger).
    float energy = clamp(size / 5.0, 0.35, 1.0);
    vColor = aColor * aIntensity * energy;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    float glow = exp(-r2 * 7.0) + 0.25 * exp(-r2 * 2.0) * (1.0 - r2);
    gl_FragColor = vec4(vColor * glow, 1.0);
  }
`;

/**
 * Far level of detail: one soft point per galaxy, in its catalog colour.
 * From the other side of the explorer a galaxy is a few pixels wide; the
 * beacon keeps it noticeable (like a faint fuzzy star) and fades out as the
 * camera approaches and the galaxy's own light takes over.
 * One draw call for every galaxy.
 */
export function createBeacons(systems) {
  const count = systems.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const radii = new Float32Array(count);
  const intensities = new Float32Array(count);
  const color = new THREE.Color();
  systems.forEach((system, i) => {
    system.center.toArray(positions, i * 3);
    color.set(system.entry.color).toArray(colors, i * 3);
    radii[i] = system.radius;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
  const intensity = new THREE.BufferAttribute(intensities, 1);
  intensity.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aIntensity', intensity);

  const uniforms = { uProjScale: { value: 1000 } };
  const points = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({
      name: 'GalaxyBeacons',
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  points.name = 'GalaxyBeacons';
  points.frustumCulled = false;

  return {
    points,
    setViewport(heightPixels, fov) {
      uniforms.uProjScale.value = heightPixels / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
    },
    /** @param {THREE.Vector3} cameraPosition */
    update(cameraPosition, highlighted) {
      systems.forEach((system, i) => {
        const relative = system.relativeDistance(cameraPosition);
        const far = THREE.MathUtils.smoothstep(relative, 7, 16);
        intensities[i] = far * (system === highlighted ? 0.9 : 0.45);
      });
      intensity.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      points.material.dispose();
    },
  };
}

import { createRandom, gaussian, luminosity } from '../random.js';
import { createStarBuffers, createStarPopulation } from './starPoints.js';
import { STEP_MASK } from '../work.js';

/**
 * Shells and loops around an elliptical galaxy (NGC 474): faint, sharp-edged
 * caps of stars left by smaller galaxies it swallowed. Each shell is a piece
 * of a sphere, open on one side, brightest at its outer edge (where the stars
 * turn around in their orbits) and fading inwards.
 *
 * Stars give the shells their grain; soft glow sprites give the continuous,
 * ghostly light of the photographs. Both are frozen: shells change over
 * hundreds of millions of years.
 *
 * spec.stars.shells: [{ radius, thickness, axis: [x, y, z], opening (cos of the
 * half angle), weight, flatten }]
 */
export async function buildShells({ count, glowCount, spec, sharedUniforms, brightness, work }) {
  const shells = spec.stars.shells;
  const random = createRandom(spec.seed, 8);
  const total = shells.reduce((sum, shell) => sum + shell.weight, 0);
  const point = { x: 0, y: 0, z: 0 };

  function sampleShell(shell) {
    const [ax, ay, az] = normalize(shell.axis);
    // Uniform direction inside the cap (cos θ between opening and 1).
    const cosT = shell.opening + (1 - shell.opening) * random();
    const sinT = Math.sqrt(1 - cosT * cosT);
    const phi = random() * Math.PI * 2;
    // Orthonormal basis around the axis.
    const [ux, uy, uz] = normalize(Math.abs(ay) < 0.9 ? cross(ax, ay, az, 0, 1, 0) : cross(ax, ay, az, 1, 0, 0));
    const [vx, vy, vz] = cross(ax, ay, az, ux, uy, uz);
    const dx = ax * cosT + (ux * Math.cos(phi) + vx * Math.sin(phi)) * sinT;
    const dy = ay * cosT + (uy * Math.cos(phi) + vy * Math.sin(phi)) * sinT;
    const dz = az * cosT + (uz * Math.cos(phi) + vz * Math.sin(phi)) * sinT;
    // Sharp outer edge, softer inner side; fainter towards the open rim.
    const r = shell.radius * (1 - shell.thickness * Math.pow(random(), 2));
    point.x = dx * r;
    point.y = dy * r * (shell.flatten ?? 1);
    point.z = dz * r;
    return (cosT - shell.opening) / (1 - shell.opening);
  }

  function pickShell() {
    let u = random() * total;
    for (const shell of shells) {
      u -= shell.weight;
      if (u <= 0) return shell;
    }
    return shells[shells.length - 1];
  }

  const buffers = createStarBuffers(count);
  for (let i = 0; i < count; i++) {
    if ((i & STEP_MASK) === 0) await work.step();
    const rim = sampleShell(pickShell());
    const bright = luminosity(random, 3.2) * (0.4 + 0.6 * rim);
    buffers.set(i, point.x, point.y, point.z, 1.1 + 0.6 * random(), bright, 0.2 + 0.3 * random(), random());
  }

  const glowBuffers = createStarBuffers(glowCount);
  for (let i = 0; i < glowCount; i++) {
    const rim = sampleShell(pickShell());
    glowBuffers.set(
      i,
      point.x + gaussian(random) * 0.08,
      point.y + gaussian(random) * 0.08,
      point.z + gaussian(random) * 0.08,
      (0.5 + 0.9 * random()) * shellsGlowSize(spec), // sprite diameter (kpc)
      (0.3 + 0.7 * random()) * (0.35 + 0.65 * rim),
      0.3 + 0.2 * random(),
      random(),
    );
  }

  return {
    stars: createStarPopulation({ name: `${spec.name}ShellStars`, buffers, sharedUniforms, brightness: brightness.shells }),
    glow: createStarPopulation({
      name: `${spec.name}ShellGlow`,
      buffers: glowBuffers,
      sharedUniforms,
      kind: 'glow',
      brightness: brightness.shellGlow,
      compensation: 0,
    }),
  };
}

function shellsGlowSize(spec) {
  return spec.stars.shellGlowSize ?? 2.2;
}

function normalize([x, y, z]) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function cross(ax, ay, az, bx, by, bz) {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

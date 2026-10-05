import * as THREE from 'three';
import { createRandom, gaussian, luminosity } from '../random.js';
import { createStarBuffers, createStarPopulation } from './starPoints.js';
import { STEP_MASK } from '../work.js';

/**
 * Tidal features of interacting galaxies: the long curved tails of the
 * Antennae, the bridge between the members of Arp 87, the stream around Arp
 * 142. Each stream follows a smooth 3D curve (Catmull-Rom through control
 * points), widens along its length and fades towards its end.
 *
 * Stars (old and young, with blue knots where the gas is compressed) give the
 * streams their grain; soft glow sprites their continuous light. Everything
 * is frozen in a representative instant: these encounters take hundreds of
 * millions of years.
 *
 * stream: { points: [[x, y, z]...], width: [start, end], weight, young (0..1),
 *           knots (clusters along the stream), brightness, glow (share of sprites),
 *           fade (how fast it dims along its length) }
 */
export async function buildTidalStreams({ count, glowCount, streams, seed, name, sharedUniforms, brightness, work }) {
  const random = createRandom(seed, 9);
  const curves = streams.map((stream) => ({
    stream,
    curve: new THREE.CatmullRomCurve3(stream.points.map((p) => new THREE.Vector3(...p)), false, 'centripetal'),
  }));
  const total = streams.reduce((sum, stream) => sum + stream.weight, 0);
  const point = new THREE.Vector3();

  function pick() {
    let u = random() * total;
    for (const entry of curves) {
      u -= entry.stream.weight;
      if (u <= 0) return entry;
    }
    return curves[curves.length - 1];
  }

  /** A point of a stream; returns its position along it (0 at the root). */
  function sample(entry, spread = 1) {
    const { stream, curve } = entry;
    const t = Math.pow(random(), stream.fade ?? 1.3);
    curve.getPointAt(t, point);
    const width = (stream.width[0] + (stream.width[1] - stream.width[0]) * t) * spread;
    point.x += gaussian(random, 2.5) * width;
    point.y += gaussian(random, 2.5) * width * (stream.thickness ?? 0.5);
    point.z += gaussian(random, 2.5) * width;
    return t;
  }

  const buffers = createStarBuffers(count);
  for (let i = 0; i < count; i++) {
    if ((i & STEP_MASK) === 0) await work.step();
    const entry = pick();
    const { stream } = entry;
    let t;
    let temperature;
    let bright;
    if (stream.knots && random() < stream.knots) {
      // Young blue clumps where the gas of the stream is compressed.
      t = sample(entry, 0.35);
      temperature = 0.72 + 0.28 * random();
      bright = luminosity(random, 2.6) * 1.2;
    } else {
      t = sample(entry);
      const young = random() < (stream.young ?? 0.3);
      temperature = young ? 0.62 + 0.35 * random() : 0.22 + 0.3 * random();
      bright = luminosity(random, 3.2);
    }
    const dim = (stream.brightness ?? 1) * (1 - 0.6 * t);
    buffers.set(i, point.x, point.y, point.z, 1.1 + 0.7 * random() + 0.5 * bright, bright * dim, temperature, random());
  }

  const glowBuffers = createStarBuffers(glowCount);
  for (let i = 0; i < glowCount; i++) {
    const entry = pick();
    const t = sample(entry, 0.6);
    const { stream } = entry;
    glowBuffers.set(
      i,
      point.x,
      point.y,
      point.z,
      (stream.width[0] + (stream.width[1] - stream.width[0]) * t) * 1.6 * (0.6 + 0.8 * random()), // kpc
      (0.4 + 0.6 * random()) * (stream.brightness ?? 1) * (1 - 0.7 * t),
      (stream.young ?? 0.3) > 0.5 ? 0.66 + 0.2 * random() : 0.5 + 0.2 * random(), // bluish white
      random(),
    );
  }

  return {
    stars: createStarPopulation({ name: `${name}TidalStars`, buffers, sharedUniforms, brightness: brightness.stars }),
    glow: createStarPopulation({
      name: `${name}TidalGlow`,
      buffers: glowBuffers,
      sharedUniforms,
      kind: 'glow',
      brightness: brightness.glow,
      compensation: 0,
    }),
  };
}

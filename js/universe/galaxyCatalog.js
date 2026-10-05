import { MAP_DEFAULTS } from '../galaxies/galaxyMap.js';
import { deepMerge, scaleSpec } from './specTools.js';

/**
 * GALAXY_CATALOG: every galaxy of the explorer, in one place.
 *
 * Each entry has two clearly separated halves:
 *
 *  - SCIENCE (what the information card shows): name, catalogue names, type,
 *    constellation, distance, sky position and sources. Only values checked
 *    against the cited source; no invented number. When a distance is only an
 *    estimate (from the redshift), the card says so.
 *
 *  - VISUALISATION (what draws it): procedural parameters, size in the scene,
 *    orientation, colour, seed, share of the star budget. These are artistic
 *    choices made to resemble the reference photographs, not measurements.
 *
 * Positions: each galaxy lies in its real direction on the sky (right
 * ascension / declination from NED, celestial north = +Y), seen from the
 * starting point (our Galaxy). Distances between galaxies are COMPRESSED on a
 * logarithmic scale (see navigationDistance): in real proportions Hoag's
 * Object would be 220 times further than Andromeda and no two galaxies would
 * ever fit on the same screen.
 *
 * Inside a galaxy, 1 unit ≈ 1 kpc ≈ 3 260 light-years and sizes are roughly
 * realistic; some small galaxies are enlarged a little to stay legible.
 */

const DEG = Math.PI / 180;
const tan = (degrees) => Math.tan(degrees * DEG);

// ---------------------------------------------------------------------------
// Scale of the explorer
// ---------------------------------------------------------------------------

/** Scene distance of M31 from the starting point. */
const NAV_BASE = 120;
/** Scene units per factor 10 in real distance. */
const NAV_PER_DECADE = 160;
const M31_LIGHT_YEARS = 2.5e6;

/**
 * Compressed scene distance (units) for a real distance (light-years):
 * 120 for Andromeda, +160 for every factor of ten further.
 */
export function navigationDistance(lightYears) {
  return NAV_BASE + NAV_PER_DECADE * Math.log10(lightYears / M31_LIGHT_YEARS);
}

/** Unit vector towards a sky position (degrees). +Y is the celestial north pole. */
export function skyDirection(ra, dec) {
  const a = ra * DEG;
  const d = dec * DEG;
  // East is to the left of north, as on the sky seen from inside.
  return [Math.cos(d) * Math.cos(a), Math.sin(d), -Math.cos(d) * Math.sin(a)];
}

// ---------------------------------------------------------------------------
// Template: M31, the most detailed galaxy. Every other disc galaxy starts from
// it, changes what differs in its structure, then is scaled to its own size.
// ---------------------------------------------------------------------------

export const DISC_TEMPLATE = {
  mapRadius: 28, // half-size of the square procedural map (kpc)
  map: structuredClone(MAP_DEFAULTS), // see shaders/map.glsl.js
  rotation: {
    patternPeriod: 600, // seconds per turn of the spiral pattern at 1×
    corotation: 12, // radius where the stars turn as fast as the pattern
    curveRadius: 1.4, // v(R) = V (1 - e^(-R/curveRadius))
    bulge: 0.55, // the bulge turns slower (partly pressure supported)
    halo: 0.12,
  },
  // Density-wave orbits of the old disc (MOTION_ELLIPSE in stars.glsl.js).
  orbits: {
    tanPitch: tan(11),
    ellipseOffset: 0.18 * Math.PI, // puts the crowding of the ellipses on the arms
    eccentricity: 0.05,
    eccWindow: [2, 5, 17, 24],
  },
  disk: {
    scaleLength: 5.2,
    inner: 1.0,
    outer: 26,
    oldSigma: 0.32, // vertical dispersion of the old disc (kpc)
    youngSigma: 0.1, // young stars, gas and dust stay near the mid-plane
    dustSigma: 0.11,
    flare: [0.75, 0.022], // the disc thickens outwards
    hotRadius: 7, // beyond it, a sprinkle of hotter F/A stars
    hotFraction: 0.12,
  },
  // Diffuse light (HDR units before exposure). The bulge is a sum of Gaussian
  // ellipsoids: surface = peak surface brightness, sigma in kpc, q = axis ratio.
  light: {
    diskRadius: 27,
    bulge: [
      { surface: 6.0, sigma: 0.05, q: 0.9, color: [1.0, 0.97, 0.92] }, // nucleus
      { surface: 1.35, sigma: 0.36, q: 0.8, color: [1.0, 0.92, 0.78] },
      { surface: 0.9, sigma: 1.15, q: 0.68, color: [1.0, 0.86, 0.64] },
      { surface: 0.36, sigma: 2.9, q: 0.56, color: [1.0, 0.82, 0.6] },
    ],
    disk: 0.3, // old disc at R = 0, face-on
    young: 0.16, // blue light of the arms
    hii: 0.05, // pink star-forming regions
    dust: 9.0, // optical depth per kpc of dense dust
    oldInner: [1.0, 0.84, 0.62],
    oldOuter: [0.95, 0.92, 0.88],
    oldRange: [4, 16],
    youngColor: [0.4, 0.6, 1.0],
    hiiColor: [1.0, 0.36, 0.48],
  },
  stars: {
    // Share of the galaxy's star budget per population (M31 on ULTRA: 356 k).
    shares: {
      bulge: 0.2251,
      disk: 0.3939,
      arms: 0.2814,
      highlights: 0.00394,
      nebulae: 0.00197,
      halo: 0.0394,
      satellites: 0.0563,
    },
    brightness: {
      bulge: 0.55,
      disk: 0.5,
      arms: 0.75,
      highlights: 1.5,
      nebulae: 0.12,
      halo: 0.5,
      satellites: 0.3,
      bar: 0.5,
      shells: 0.4,
      shellGlow: 0.05,
    },
    bulge: {
      scale: 1.05, // Hernquist scale radius
      max: 6.5,
      flattening: 0.64,
      depth: 0.9, // slight triaxiality
      nucleus: 0.035,
      nucleusRadius: 0.09,
      temperature: [0.14, 0.3],
    },
    arms: {
      scale: 6.2,
      inner: 2.8,
      outer: 25,
      associations: 0.32, // share of the young stars in OB associations
      knotScale: 6.5,
      knotInner: 3.2,
      knotOuter: 24,
      spread: 1,
    },
    halo: { inner: 3, outer: 60, flattening: 0.75, clusterRadius: 34, globularShare: 0.34 },
  },
};

/** Spheroid template for elliptical galaxies (no disc, no map). */
const ELLIPTICAL_TEMPLATE = {
  mapRadius: 1,
  map: null,
  disk: null,
  rotation: { patternPeriod: 600, corotation: 12, curveRadius: 1.4, bulge: 0.3, halo: 0.1 },
  orbits: { tanPitch: tan(11), ellipseOffset: 0, eccentricity: 0, eccWindow: [2, 5, 17, 24] },
  light: {
    diskRadius: 0,
    bulge: [],
    disk: 0,
    young: 0,
    hii: 0,
    dust: 0,
    oldInner: [1, 0.85, 0.65],
    oldOuter: [1, 0.85, 0.65],
    oldRange: [1, 2],
    youngColor: [0.4, 0.6, 1.0],
    hiiColor: [1.0, 0.36, 0.48],
  },
  stars: {
    shares: { bulge: 0.85, halo: 0.15 },
    brightness: DISC_TEMPLATE.stars.brightness,
    bulge: { scale: 1, max: 8, flattening: 0.8, depth: 0.95, nucleus: 0.02, nucleusRadius: 0.06, temperature: [0.15, 0.28] },
    arms: DISC_TEMPLATE.stars.arms,
    halo: { inner: 2, outer: 20, flattening: 0.85, clusterRadius: 14, globularShare: 0.35 },
  },
};

/**
 * A disc galaxy: the template, changed by `overrides` (template units), then
 * scaled by `scale`; `final` is merged after scaling (exact kpc values).
 */
function discBody({ name, seed, scale = 1, starWeight, overrides = {}, final = {}, frame }) {
  const spec = scaleSpec(deepMerge(DISC_TEMPLATE, overrides), scale);
  return finishBody(deepMerge(spec, final), { name, seed, scale, starWeight, frame });
}

function ellipticalBody({ name, seed, scale = 1, starWeight, spec, frame }) {
  return finishBody(deepMerge(ELLIPTICAL_TEMPLATE, spec), { name, seed, scale, starWeight, frame });
}

function finishBody(spec, { name, seed, scale, starWeight, frame }) {
  spec.name = name;
  spec.seed = seed;
  spec.scale = scale;
  spec.starWeight = starWeight;
  spec.frame = frame ?? null;
  return spec;
}

/**
 * Barred spirals: the arms must start at the ends of the bar. Sets the phase
 * of the arms (and of the density-wave ellipses) so that an arm passes through
 * each end of the bar. Lengths in final kpc.
 */
function alignArmsToBar(spec) {
  const [m, tanPitch] = spec.map.arms;
  const [length, , angle] = spec.map.bar;
  // Arm ridge: m (φ - ln r / tan p) + phase = 0  ->  through (r = length, φ = angle).
  const phase = -m * (angle - Math.log(length) / tanPitch);
  spec.map.arms[3] = phase;
  spec.orbits.ellipseOffset = 0.18 * Math.PI - phase / m;
  return spec;
}

/** Bar light: an elongated Gaussian turning with the pattern (template units). */
function barLight({ surface, length, width, height, angle, color = [1.0, 0.88, 0.7] }) {
  return { surface, sigma: length * 0.55, axes: [1, height / length, width / length], angle, pattern: true, color };
}

// ---------------------------------------------------------------------------
// Satellites of M31 (inside its galaxy frame)
// ---------------------------------------------------------------------------

const M31_SATELLITES = [
  {
    name: 'M32',
    center: [1.6, -2.4, 8.2],
    rotation: [0.3, 0.6, 0.15],
    axes: [1, 0.8, 0.86],
    scale: 0.22,
    max: 1.8,
    share: 0.32,
    starBrightness: 0.9,
    core: { sigma: 0.12, surface: 1.5, color: [1.0, 0.95, 0.88] },
    envelope: { sigma: 0.5, surface: 0.3, color: [1.0, 0.88, 0.72] },
    temperature: [0.2, 0.45],
  },
  {
    name: 'M110',
    center: [-2.8, 4.6, -6.2],
    rotation: [0.5, -0.4, 0.9],
    axes: [1, 0.5, 0.62],
    scale: 0.65,
    max: 4.2,
    share: 0.68,
    starBrightness: 0.4,
    core: { sigma: 0.22, surface: 0.36, color: [1.0, 0.93, 0.84] },
    envelope: { sigma: 0.95, surface: 0.2, color: [0.96, 0.88, 0.76] },
    temperature: [0.22, 0.55],
  },
];

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const NED = { label: 'NASA/IPAC Extragalactic Database (NED)', url: 'https://ned.ipac.caltech.edu/' };
const nasaMessier = (n) => ({
  label: `NASA · Hubble Messier Catalog: Messier ${n}`,
  url: `https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-${n}/`,
});
const esaHubble = (id) => ({ label: `ESA/Hubble ${id}`, url: `https://esahubble.org/images/${id}/` });

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

/*
 * Every system is seen from the starting point like in its photograph. Its
 * bodies are placed in a "picture frame" (frame.position): x to the right,
 * y towards the observer, z downwards, like the axes of the image. A body's
 * frame.orientation: inclination (0 = face-on, ±90 = edge-on, the sign picks
 * the near side), positionAngle (screen rotation, counter-clockwise) and spin
 * (phase of the arms). Optional view: { framing (× the home distance of the
 * observation mode), roll (degrees) }. radius: size used for the level of
 * detail and the selection (kpc, visual). starWeight: share of the quality
 * profile's star budget (M31 = 1); lod: what the closest level shows.
 */
export const GALAXY_CATALOG = [
  {
    id: 'm31',
    name: 'Galáxia de Andrômeda',
    altNames: 'M31 · NGC 224',
    classification: 'Galáxia espiral',
    constellation: 'Andrômeda',
    distance: { lightYears: 2.5e6, label: '≈ 2,5 milhões de anos-luz', estimate: false },
    sky: { ra: 10.68479, dec: 41.26907 },
    description:
      'A grande galáxia espiral mais próxima da Via Láctea, visível a olho nu em céus escuros. ' +
      'Um bojo amarelado e brilhante, braços muito enrolados dominados por um anel de formação ' +
      'estelar, faixas de poeira e duas companheiras elípticas: M32 e M110.',
    sources: [nasaMessier(31), NED],
    // --- visualisation ---
    color: '#ffd9a6',
    radius: 24.5,
    seed: 224, // NGC 224
    starWeight: 1,
    lod: 'Mais detalhada: bojo, disco, braços, regiões HII, poeira, halo, aglomerados, M32 e M110',
    bodies: [
      discBody({
        name: 'M31',
        seed: 224,
        starWeight: 1,
        frame: { orientation: { inclination: -74, positionAngle: 28, spin: 0 } },
        final: { satellites: M31_SATELLITES },
      }),
    ],
  },

  {
    id: 'm104',
    name: 'Galáxia do Sombreiro',
    altNames: 'M104 · NGC 4594',
    classification: 'Galáxia espiral vista quase de perfil',
    constellation: 'Virgem',
    distance: { lightYears: 28e6, label: '≈ 28 milhões de anos-luz', estimate: false },
    sky: { ra: 189.99763, dec: -11.62309 },
    description:
      'Um bojo enorme e brilhante, quase esférico, atravessado por um disco fino visto quase de ' +
      'perfil, com uma faixa de poeira escura muito marcada. Seu halo é rico em aglomerados globulares.',
    sources: [nasaMessier(104), NED],
    color: '#ffe2b8',
    radius: 15,
    seed: 4594,
    starWeight: 0.75,
    lod: 'Bojo gigante em camadas, disco fino com anel de poeira, halo com aglomerados globulares',
    view: { framing: 1.45 }, // the photographs show its whole halo
    bodies: [
      discBody({
        name: 'M104',
        seed: 4594,
        scale: 0.55,
        starWeight: 0.75,
        frame: { orientation: { inclination: -80, positionAngle: -4, spin: 40 } },
        overrides: {
          map: {
            arms: [2, tan(6), 2, 0],
            spur: [0, 1.6, 10, 1.9],
            youngEnv: [13, 16, 21.5, 25],
            ring: [18.5, 2.2, 0.55, 0.2],
            ringShape: [0, 0, 1, 0.55],
            segments: [0.15, -0.5, 0.3, 0.55],
            clouds: [0.42, -0.35, 0.6, 0.02],
            knots: [1.3, 0.62, 0.95, 1.6],
            lanes: [0.4, 4, 0.45, 0],
            inner: [0, 0.78, 8, 0.8],
            dustRing: [18, 2.8, 1.25, 0],
            dustEnv: [11, 14.5, 22.5, 26],
            dustMix: [0.6, 0.45, 0.2, 0.18],
            diffuseDust: [0.22, 12, 21, 25.5],
            warp: [0.04, 0.6, 0.3, 0.2],
            mix: [1, 0.55, 0.5, 0.2],
          },
          orbits: { tanPitch: tan(6), eccentricity: 0.02 },
          disk: { scaleLength: 9, inner: 5, oldSigma: 0.34, youngSigma: 0.12, dustSigma: 0.15, hotFraction: 0.02 },
          light: {
            bulge: [
              { surface: 7.0, sigma: 0.06, q: 0.92, color: [1.0, 0.97, 0.92] },
              { surface: 1.9, sigma: 0.6, q: 0.86, color: [1.0, 0.92, 0.8] },
              { surface: 1.05, sigma: 2.1, q: 0.8, color: [1.0, 0.88, 0.7] },
              { surface: 0.45, sigma: 5.0, q: 0.76, color: [1.0, 0.86, 0.68] },
              { surface: 0.12, sigma: 11, q: 0.78, color: [0.96, 0.86, 0.72] },
            ],
            disk: 0.26,
            young: 0.05,
            hii: 0.015,
            dust: 24,
            oldInner: [1.0, 0.86, 0.66],
            oldOuter: [1.0, 0.9, 0.78],
          },
          stars: {
            shares: { bulge: 0.46, disk: 0.25, arms: 0.06, highlights: 0.001, nebulae: 0.0005, halo: 0.21, satellites: 0 },
            bulge: { scale: 2.6, max: 18, flattening: 0.74, depth: 1, nucleus: 0.02, nucleusRadius: 0.2, temperature: [0.15, 0.3] },
            arms: { scale: 30, inner: 14, outer: 24, associations: 0.2, knotScale: 30, knotInner: 15, knotOuter: 23, spread: 0.8 },
            halo: { inner: 3, outer: 55, flattening: 0.8, clusterRadius: 36, globularShare: 0.55 },
          },
        },
      }),
    ],
  },

  {
    id: 'm64',
    name: 'Galáxia do Olho Negro',
    altNames: 'M64 · NGC 4826',
    classification: 'Galáxia espiral',
    constellation: 'Cabeleira de Berenice',
    distance: { lightYears: 17e6, label: '≈ 17 milhões de anos-luz', estimate: false },
    sky: { ra: 194.18196, dec: 21.68299 },
    description:
      'Espiral apelidada de “Olho Negro” pela faixa escura de poeira que passa diante do seu núcleo ' +
      'brilhante. Fora dessa faixa, o disco é liso, com braços suaves e pouco marcados.',
    sources: [nasaMessier(64), NED],
    color: '#ffdcb0',
    radius: 12.5,
    seed: 4826,
    starWeight: 0.5,
    lod: 'Anel de poeira assimétrico diante do núcleo, disco liso, braços suaves',
    bodies: [
      discBody({
        name: 'M64',
        seed: 4826,
        scale: 0.45,
        starWeight: 0.5,
        frame: { orientation: { inclination: -60, positionAngle: 150, spin: 10 } },
        overrides: {
          map: {
            arms: [2, tan(9), 2.4, 0],
            spur: [0.2, 1.6, 8, 1.4],
            youngEnv: [5, 8, 14, 20],
            ring: [8, 2.2, 0.3, 0.4],
            segments: [0.15, -0.5, 0.3, 0.5],
            clouds: [0.42, -0.35, 0.6, 0.04],
            inner: [0.2, 0.9, 4, 0.5],
            innerEnv: [2, 3.5, 9, 12],
            dustRing: [9.8, 0.75, 0, 0],
            dustEnv: [2.5, 4, 12, 17],
            lanes: [0.6, 5, 0.45, 0],
            central: [2.4, 1.1, 3.0, 0.8],
            diffuseDust: [0.08, 9, 18, 24],
            mix: [1, 0.16, 0.8, 0.18],
          },
          orbits: { tanPitch: tan(9), eccentricity: 0.03 },
          disk: { scaleLength: 5.6 },
          light: {
            bulge: [
              { surface: 6.5, sigma: 0.05, q: 0.9, color: [1.0, 0.97, 0.92] },
              { surface: 1.7, sigma: 0.45, q: 0.82, color: [1.0, 0.92, 0.8] },
              { surface: 0.95, sigma: 1.4, q: 0.72, color: [1.0, 0.87, 0.68] },
              { surface: 0.3, sigma: 3.4, q: 0.65, color: [1.0, 0.85, 0.66] },
            ],
            disk: 0.38,
            young: 0.1,
            hii: 0.06,
            dust: 18,
            oldOuter: [0.98, 0.9, 0.8],
          },
          stars: {
            shares: { bulge: 0.27, disk: 0.5, arms: 0.16, highlights: 0.003, nebulae: 0.002, halo: 0.05, satellites: 0 },
            arms: { scale: 7, inner: 4, outer: 22, associations: 0.25, knotScale: 7, knotInner: 5, knotOuter: 20, spread: 0.8 },
          },
        },
      }),
    ],
  },

  {
    id: 'm83',
    name: 'Cata-vento do Sul',
    altNames: 'M83 · NGC 5236',
    classification: 'Galáxia espiral barrada',
    constellation: 'Hidra',
    distance: { lightYears: 15e6, label: '≈ 15 milhões de anos-luz', estimate: false },
    sky: { ra: 204.25396, dec: -29.86542 },
    description:
      'Espiral barrada vista quase de frente: braços bem definidos saem das pontas de uma barra ' +
      'central, marcados por faixas de poeira e por muitas regiões de formação de estrelas.',
    sources: [nasaMessier(83), NED],
    color: '#cfdcff',
    radius: 13.5,
    seed: 5236,
    starWeight: 0.7,
    lod: 'Barra que gira com o padrão, braços nas pontas da barra, muitas regiões HII',
    bodies: [
      alignArmsToBar(
        discBody({
          name: 'M83',
          seed: 5236,
          scale: 0.5,
          starWeight: 0.7,
          frame: { orientation: { inclination: 26, positionAngle: 30, spin: 0 } },
          overrides: {
            map: {
              arms: [2, tan(15), 7, 0],
              spur: [0.12, 1.45, 7, 1.3],
              youngEnv: [6.5, 9, 23, 27],
              ring: [10.4, 1.15, 0, 0],
              segments: [0.12, -0.7, 0.1, 0.65],
              clouds: [0.42, -0.35, 0.6, 0.03],
              cloudGain: [0.6, 0.6, 0, 0],
              knots: [1.6, 0.52, 0.9, 1.1],
              lanes: [0.55, 7, 1.2, 0],
              inner: [0, 0.78, 8, 0.8],
              dustRing: [9.8, 0.75, 0, 0],
              dustEnv: [3, 6, 20, 25],
              bar: [8, 2.2, 0.5, 0.9],
              barDust: [1.0, 1.0, 0.45, 0.25],
              warp: [0.05, 1.0, 0.32, 0.25],
              mix: [1, 1.15, 1.5, 0.22],
            },
            orbits: { tanPitch: tan(15) },
            disk: { scaleLength: 5.6 },
            light: {
              bulge: [
                { surface: 7.0, sigma: 0.06, q: 0.9, color: [1.0, 0.97, 0.94] },
                { surface: 1.0, sigma: 0.5, q: 0.8, color: [1.0, 0.92, 0.8] },
                { surface: 0.45, sigma: 1.4, q: 0.7, color: [1.0, 0.88, 0.72] },
                barLight({ surface: 0.55, length: 8, width: 2.0, height: 0.8, angle: 0.5 }),
              ],
              disk: 0.32,
              young: 0.22,
              hii: 0.12,
            },
            stars: {
              shares: { bulge: 0.1, disk: 0.37, arms: 0.36, highlights: 0.006, nebulae: 0.004, halo: 0.03, bar: 0.1, satellites: 0 },
              bulge: { scale: 0.6, max: 4, flattening: 0.7, nucleus: 0.06, nucleusRadius: 0.08, temperature: [0.2, 0.3] },
              bar: { length: 8, width: 1.8, height: 0.7, angle: 0.5 },
              arms: { scale: 7.5, inner: 6.5, outer: 25, associations: 0.38, knotScale: 8, knotInner: 6.5, knotOuter: 24, spread: 1 },
            },
          },
        }),
      ),
    ],
  },

  {
    id: 'ngc1300',
    name: 'NGC 1300',
    altNames: 'NGC 1300',
    classification: 'Galáxia espiral barrada',
    constellation: 'Erídano',
    distance: { lightYears: 60e6, label: '≈ 60 milhões de anos-luz', estimate: false },
    sky: { ra: 49.92094, dec: -19.41115 },
    description:
      'Exemplo clássico de espiral barrada: uma barra longa e brilhante, com faixas de poeira ao ' +
      'longo das bordas, cruza o centro; dois grandes braços partem de suas pontas.',
    sources: [esaHubble('opo0501a'), NED],
    color: '#d6e0ff',
    radius: 19,
    seed: 1300,
    starWeight: 0.7,
    lod: 'Barra longa com faixas de poeira, dois braços abertos a partir das pontas',
    bodies: [
      alignArmsToBar(
        discBody({
          name: 'NGC 1300',
          seed: 1300,
          scale: 0.75,
          starWeight: 0.7,
          frame: { orientation: { inclination: -42, positionAngle: -12, spin: 0 } },
          overrides: {
            map: {
              arms: [2, tan(19), 7, 0],
              spur: [0.06, 1.3, 8, 1.0],
              youngEnv: [11, 13.5, 23, 27],
              ring: [12.5, 1.6, 0.25, 0.3],
              ringShape: [0, 0, 1.25, 0.6],
              segments: [0.1, -0.8, 0.0, 0.65],
              clouds: [0.42, -0.35, 0.6, 0.02],
              cloudGain: [0.6, 0.6, 0, 0],
              knots: [1.3, 0.55, 0.92, 1.3],
              lanes: [0.6, 6, 1.3, 0],
              inner: [0, 0.78, 8, 0.8],
              dustRing: [9.8, 0.75, 0, 0],
              dustEnv: [2, 4, 22, 26],
              diffuseDust: [0.1, 9, 20, 25],
              bar: [12, 2.6, -0.35, 1.0],
              barDust: [1.6, 1.2, 0.55, 0.15],
              warp: [0.04, 0.9, 0.3, 0.2],
              mix: [1, 1.05, 1.1, 0.22],
            },
            orbits: { tanPitch: tan(19) },
            disk: { scaleLength: 6.5 },
            light: {
              bulge: [
                { surface: 6.0, sigma: 0.05, q: 0.9, color: [1.0, 0.97, 0.92] },
                { surface: 1.1, sigma: 0.4, q: 0.85, color: [1.0, 0.92, 0.8] },
                { surface: 0.5, sigma: 1.3, q: 0.75, color: [1.0, 0.88, 0.72] },
                barLight({ surface: 0.5, length: 12, width: 2.6, height: 0.9, angle: -0.35 }),
              ],
              disk: 0.24,
              young: 0.2,
              hii: 0.07,
              dust: 10,
            },
            stars: {
              shares: { bulge: 0.1, disk: 0.33, arms: 0.36, highlights: 0.005, nebulae: 0.003, halo: 0.03, bar: 0.14, satellites: 0 },
              bulge: { scale: 0.7, max: 4.5, flattening: 0.75, nucleus: 0.05, nucleusRadius: 0.08 },
              bar: { length: 12, width: 2.4, height: 0.8, angle: -0.35 },
              arms: { scale: 9, inner: 9.5, outer: 26, associations: 0.35, knotScale: 9, knotInner: 10, knotOuter: 25, spread: 1 },
            },
          },
        }),
      ),
    ],
  },

  {
    id: 'ngc1566',
    name: 'NGC 1566',
    altNames: 'NGC 1566',
    classification: 'Galáxia espiral',
    constellation: 'Dourado',
    distance: { lightYears: 60e6, label: '≈ 60 milhões de anos-luz', estimate: false },
    sky: { ra: 65.00164, dec: -54.93794 },
    description:
      'Espiral vista quase de frente, com dois braços proeminentes e simétricos, cheios de ' +
      'aglomerados de estrelas jovens e de faixas de poeira, em volta de um núcleo muito brilhante.',
    sources: [{ label: 'ESA/Webb weic2403j', url: 'https://esawebb.org/images/weic2403j/' }, NED],
    color: '#c8d8ff',
    radius: 16,
    seed: 1566,
    starWeight: 0.65,
    lod: 'Dois braços dominantes com aglomerados azuis, poeira e núcleo compacto',
    bodies: [
      discBody({
        name: 'NGC 1566',
        seed: 1566,
        scale: 0.62,
        starWeight: 0.65,
        frame: { orientation: { inclination: 30, positionAngle: 70, spin: 0 } },
        overrides: {
          map: {
            arms: [2, tan(22), 6, 0],
            spur: [0.15, 1.5, 6, 2.2],
            youngEnv: [3.5, 6, 21, 26],
            ring: [10.4, 1.15, 0, 0],
            segments: [0.1, -0.8, 0.1, 0.65],
            clouds: [0.4, -0.3, 0.6, 0.03],
            cloudGain: [0.6, 0.6, 0, 0],
            knots: [1.5, 0.52, 0.9, 1.0],
            lanes: [0.5, 6, 1.4, 0],
            inner: [0.4, 0.8, 6, 0.3],
            innerEnv: [1.5, 3, 6, 9],
            dustRing: [9.8, 0.75, 0, 0],
            dustEnv: [1.5, 3, 21, 26],
            warp: [0.05, 1.2, 0.3, 0.3],
            mix: [1, 1.2, 1.5, 0.22],
          },
          orbits: { tanPitch: tan(22) },
          light: {
            bulge: [
              { surface: 9.0, sigma: 0.04, q: 0.9, color: [1.0, 0.98, 0.95] },
              { surface: 1.4, sigma: 0.35, q: 0.85, color: [1.0, 0.93, 0.82] },
              { surface: 0.6, sigma: 1.1, q: 0.75, color: [1.0, 0.88, 0.72] },
              { surface: 0.2, sigma: 2.6, q: 0.7, color: [1.0, 0.86, 0.68] },
            ],
            disk: 0.26,
            young: 0.24,
            hii: 0.1,
            dust: 10,
          },
          stars: {
            shares: { bulge: 0.15, disk: 0.36, arms: 0.4, highlights: 0.005, nebulae: 0.003, halo: 0.04, satellites: 0 },
            arms: { scale: 8, inner: 3.5, outer: 25, associations: 0.4, knotScale: 8, knotInner: 4, knotOuter: 24, spread: 1 },
          },
        },
      }),
    ],
  },

  {
    id: 'ngc4414',
    name: 'NGC 4414',
    altNames: 'NGC 4414',
    classification: 'Galáxia espiral',
    constellation: 'Cabeleira de Berenice',
    distance: { lightYears: 60e6, label: '≈ 60 milhões de anos-luz', estimate: false },
    sky: { ra: 186.61312, dec: 31.22353 },
    description:
      'Espiral sem braços longos e contínuos: o disco é coberto por muitos fragmentos curtos de ' +
      'braços e de poeira (aspecto “floculento”), azulados por fora e amarelados perto do centro.',
    sources: [esaHubble('opo9925a'), NED],
    color: '#ffe0b8',
    radius: 12,
    seed: 4414,
    starWeight: 0.55,
    lod: 'Braços fragmentados (floculentos), poeira em retalhos',
    bodies: [
      discBody({
        name: 'NGC 4414',
        seed: 4414,
        scale: 0.45,
        starWeight: 0.55,
        frame: { orientation: { inclination: -55, positionAngle: 160, spin: 30 } },
        overrides: {
          map: {
            arms: [2, tan(18), 2, 0],
            spur: [0, 1.6, 10, 1.9],
            floc: [1, 7, 0.18, 2.5],
            youngEnv: [5, 9, 20, 26],
            ring: [10.4, 1.15, 0, 0],
            segments: [0.25, -0.4, 0.4, 0.25],
            clouds: [0.6, -0.3, 0.6, 0.1],
            knots: [1.8, 0.6, 0.95, 1.6],
            lanes: [0.5, 4, 1.1, 0],
            inner: [0, 0.78, 8, 0.8],
            dustRing: [9.8, 0.75, 0, 0],
            dustEnv: [3, 5, 19, 25],
            dustMix: [0.9, 0.6, 0.35, 0.12],
            diffuseDust: [0.18, 9, 20, 25],
            mix: [1.2, 0.8, 0.6, 0.3],
          },
          orbits: { tanPitch: tan(18), eccentricity: 0.015 },
          light: {
            bulge: [
              { surface: 5.0, sigma: 0.05, q: 0.9, color: [1.0, 0.96, 0.9] },
              { surface: 1.3, sigma: 0.45, q: 0.8, color: [1.0, 0.9, 0.76] },
              { surface: 0.6, sigma: 1.4, q: 0.7, color: [1.0, 0.86, 0.66] },
            ],
            disk: 0.36,
            young: 0.11,
            hii: 0.02,
            dust: 11,
            oldInner: [1.0, 0.82, 0.58],
          },
          stars: {
            shares: { bulge: 0.2, disk: 0.5, arms: 0.22, highlights: 0.002, nebulae: 0.0008, halo: 0.04, satellites: 0 },
            arms: { scale: 8, inner: 5, outer: 24, associations: 0.3, knotScale: 8, knotInner: 6, knotOuter: 23, spread: 0.8 },
          },
        },
      }),
    ],
  },

  {
    id: 'hoag',
    name: 'Objeto de Hoag',
    altNames: 'PGC 54559',
    classification: 'Galáxia anelar',
    constellation: 'Serpente (Cabeça)',
    distance: { lightYears: 550e6, label: '≈ 550 milhões de anos-luz', estimate: false },
    size: '≈ 120 mil anos-luz de diâmetro',
    sky: { ra: 229.31005, dec: 21.58554 },
    description:
      'Galáxia rara: um anel quase perfeito de estrelas jovens e azuis envolve um núcleo amarelo ' +
      'de estrelas velhas. Entre os dois, uma faixa que parece vazia. A origem do anel ainda é debatida.',
    sources: [esaHubble('opo0221a'), NED],
    color: '#a9c4ff',
    radius: 20,
    seed: 54559,
    starWeight: 0.5,
    lod: 'Núcleo esferoidal, intervalo escuro, anel 3D irregular de aglomerados azuis',
    bodies: [
      discBody({
        name: 'Hoag',
        seed: 54559,
        starWeight: 0.5,
        frame: { orientation: { inclination: 18, positionAngle: 10, spin: 0 } },
        overrides: {
          mapRadius: 22,
          map: {
            arms: [0, tan(11), 4, 0],
            spur: [0, 1.6, 10, 1.9],
            youngEnv: [12.5, 13.8, 18.2, 20.5],
            ring: [15.6, 1.75, 1, 0.55],
            ringShape: [0.35, -0.25, 1.03, 0.6],
            segments: [0.16, -0.6, 0.25, 0.4],
            clouds: [0.35, -0.3, 0.6, 0],
            cloudGain: [0.45, 0.8, 0, 0],
            knots: [1.4, 0.55, 0.93, 1.2],
            lanes: [0.62, 7, 0, 0],
            inner: [0, 0.78, 8, 0.8],
            dustRing: [15.2, 1.1, 0.3, 0],
            dustEnv: [12.5, 14, 18, 20.5],
            dustMix: [0.75, 0.45, 0.2, 0],
            diffuseDust: [0, 9, 20, 25],
            warp: [0.06, 1.3, 0.3, 0.35],
            mix: [0.6, 1.2, 1.2, 0.2],
          },
          rotation: { patternPeriod: 900, corotation: 15.6, curveRadius: 1.5 },
          orbits: { eccentricity: 0, eccWindow: [12, 14, 18, 20] },
          disk: { scaleLength: 8, inner: 11, outer: 20, oldSigma: 0.45, youngSigma: 0.3, dustSigma: 0.25, hotRadius: 12, hotFraction: 0.35 },
          light: {
            diskRadius: 21,
            bulge: [
              { surface: 4.0, sigma: 0.07, q: 0.96, color: [1.0, 0.95, 0.85] },
              { surface: 1.5, sigma: 0.75, q: 0.93, color: [1.0, 0.89, 0.7] },
              { surface: 0.55, sigma: 2.1, q: 0.9, color: [1.0, 0.85, 0.62] },
              { surface: 0.1, sigma: 4.4, q: 0.9, color: [1.0, 0.84, 0.62] },
            ],
            disk: 0.035,
            young: 0.34,
            hii: 0.04,
            dust: 2.5,
            oldInner: [0.95, 0.85, 0.7],
            oldOuter: [0.85, 0.88, 0.95],
            oldRange: [10, 18],
          },
          stars: {
            shares: { bulge: 0.33, disk: 0.12, arms: 0.47, highlights: 0.006, nebulae: 0.002, halo: 0.06, satellites: 0 },
            bulge: { scale: 1.1, max: 7, flattening: 0.92, depth: 0.95, nucleus: 0.03, nucleusRadius: 0.1, temperature: [0.15, 0.28] },
            arms: { scale: 40, inner: 12.5, outer: 20, associations: 0.42, knotScale: 40, knotInner: 13, knotOuter: 19.5, spread: 1.3 },
            halo: { inner: 3, outer: 30, flattening: 0.9, clusterRadius: 22, globularShare: 0.3 },
          },
        },
      }),
    ],
  },

  {
    id: 'cena',
    name: 'Centaurus A',
    altNames: 'NGC 5128',
    classification: 'Galáxia elíptica peculiar',
    constellation: 'Centauro',
    distance: { lightYears: 13e6, label: '≈ 13 milhões de anos-luz', estimate: false },
    sky: { ra: 201.36506, dec: -43.01911 },
    description:
      'Galáxia elíptica gigante atravessada por um disco de poeira escura e retorcido, com estrelas ' +
      'jovens e regiões de formação estelar ao longo dele — traços de uma colisão com outra galáxia.',
    sources: [{ label: 'ESO eso0903a', url: 'https://www.eso.org/public/images/eso0903a/' }, NED],
    color: '#ffd8a8',
    radius: 18,
    seed: 5128,
    starWeight: 0.65,
    lod: 'Esferoide gigante, disco de poeira empenado com aglomerados jovens',
    view: { framing: 1.5 },
    bodies: [
      discBody({
        name: 'Centaurus A',
        seed: 5128,
        starWeight: 0.65,
        frame: { orientation: { inclination: -83, positionAngle: 28, spin: 0 } },
        overrides: {
          static: true,
          mapRadius: 17,
          map: {
            arms: [0, tan(11), 4, 0],
            spur: [0, 1.6, 10, 1.9],
            youngEnv: [5, 7.5, 12.5, 15.5],
            ring: [9.6, 2.2, 0.85, 0.3],
            ringShape: [0.3, 0, 1.12, 0.7],
            segments: [0.3, -0.5, 0.3, 0.3],
            clouds: [0.6, -0.3, 0.6, 0],
            knots: [1.8, 0.55, 0.9, 1.0],
            lanes: [0.62, 7, 0, 0],
            inner: [0, 0.78, 8, 0.8],
            dustRing: [7.6, 3.2, 1.3, 0],
            central: [0, 4, 0.9, 0], // the lane also crosses in front of the nucleus
            dustEnv: [0, 0.6, 13, 15.5],
            dustMix: [1.1, 0.8, 0.5, 0.1],
            diffuseDust: [0.35, 7.5, 12, 15.5],
            warp: [0.08, 0.8, 0.45, 0.25],
            mix: [1.2, 1, 1.3, 0.2],
          },
          rotation: { corotation: 8, curveRadius: 1.2, bulge: 0.2, halo: 0.05 },
          orbits: { eccentricity: 0, eccWindow: [1, 2, 13, 15] },
          disk: { scaleLength: 5.6, inner: 1, outer: 15, oldSigma: 0.5, youngSigma: 0.35, dustSigma: 0.85, flare: [0.8, 0.03], hotRadius: 3, hotFraction: 0.25 },
          warp: { amp: 2.0, r0: 4, r1: 15.5, angle: 0.6 },
          light: {
            diskRadius: 15.6,
            bulge: [
              { surface: 5.0, sigma: 0.06, q: 0.9, color: [1.0, 0.95, 0.88] },
              { surface: 1.4, sigma: 0.7, q: 0.9, color: [1.0, 0.9, 0.76] },
              { surface: 0.8, sigma: 2.4, q: 0.86, axes: [1, 0.86, 0.92], color: [1.0, 0.87, 0.7] },
              { surface: 0.32, sigma: 6.0, q: 0.84, axes: [1, 0.84, 0.92], color: [1.0, 0.86, 0.68] },
              { surface: 0.07, sigma: 13, q: 0.84, axes: [1, 0.84, 0.92], color: [0.96, 0.86, 0.72] },
            ],
            disk: 0.08,
            young: 0.26,
            hii: 0.18,
            dust: 12,
            oldInner: [1.0, 0.86, 0.68],
            oldOuter: [1.0, 0.88, 0.74],
            oldRange: [3, 12],
          },
          stars: {
            shares: { bulge: 0.6, disk: 0.08, arms: 0.14, highlights: 0.003, nebulae: 0.003, halo: 0.17, satellites: 0 },
            bulge: { scale: 2.2, max: 20, flattening: 0.86, depth: 0.92, nucleus: 0.01, nucleusRadius: 0.1, temperature: [0.16, 0.3] },
            arms: { scale: 12, inner: 4.5, outer: 15, associations: 0.45, knotScale: 12, knotInner: 5, knotOuter: 14.5, spread: 0.7 },
            halo: { inner: 4, outer: 45, flattening: 0.85, clusterRadius: 30, globularShare: 0.4 },
          },
        },
      }),
    ],
  },

  {
    id: 'ngc474',
    name: 'NGC 474 e NGC 470',
    altNames: 'Arp 227',
    classification: 'Galáxia com conchas e espiral companheira',
    constellation: 'Peixes',
    distance: {
      lightYears: 110e6,
      label: '≈ 110 milhões de anos-luz',
      estimate: true,
      note: 'estimativa pelo desvio para o vermelho (NED, z = 0,0077; H₀ = 70 km/s/Mpc)',
    },
    sky: { ra: 20.02786, dec: 3.4155 },
    description:
      'NGC 474 é uma galáxia de tipo inicial cercada por conchas e laços de estrelas muito tênues, ' +
      'vestígios de galáxias menores que ela absorveu. Ao lado, a espiral NGC 470. ' +
      'O sistema é representado em um estado visual congelado.',
    sources: [NED],
    color: '#ffe6c4',
    radius: 34,
    seed: 474,
    starWeight: 0.55,
    lod: 'Esferoide com conchas e laços estelares (estrelas + brilho difuso), espiral companheira',
    view: { roll: 0 },
    bodies: [
      ellipticalBody({
        name: 'NGC 474',
        seed: 474,
        starWeight: 0.36,
        frame: { position: [-6, 0, 2], orientation: { inclination: 30, positionAngle: 20, spin: 0 } },
        spec: {
          static: true,
          light: {
            bulge: [
              { surface: 4.5, sigma: 0.05, q: 0.95, color: [1.0, 0.96, 0.9] },
              { surface: 1.3, sigma: 0.6, q: 0.92, color: [1.0, 0.9, 0.76] },
              { surface: 0.6, sigma: 2.0, q: 0.9, color: [1.0, 0.87, 0.7] },
              { surface: 0.16, sigma: 5.0, q: 0.9, color: [1.0, 0.86, 0.7] },
            ],
          },
          stars: {
            shares: { bulge: 0.45, halo: 0.1, shells: 0.45, shellGlow: 0.08 },
            brightness: { shells: 0.2, shellGlow: 0.009 },
            bulge: { scale: 1.2, max: 12, flattening: 0.9, depth: 0.95, nucleus: 0.02, nucleusRadius: 0.06, temperature: [0.15, 0.28] },
            halo: { inner: 3, outer: 34, flattening: 0.9, clusterRadius: 24, globularShare: 0.3 },
            shellGlowSize: 1.5,
            shells: [
              { radius: 7, thickness: 0.07, axis: [1, 0.15, 0.2], opening: 0.6, weight: 0.7, flatten: 0.9 },
              { radius: 9.5, thickness: 0.07, axis: [-1, -0.1, -0.25], opening: 0.62, weight: 0.8, flatten: 0.92 },
              { radius: 12.5, thickness: 0.06, axis: [0.6, 0.3, -0.75], opening: 0.66, weight: 0.9, flatten: 0.9 },
              { radius: 16, thickness: 0.06, axis: [-0.5, -0.2, 0.85], opening: 0.64, weight: 0.9, flatten: 0.88 },
              { radius: 20, thickness: 0.05, axis: [0.9, -0.25, 0.4], opening: 0.68, weight: 1.0, flatten: 0.95 },
              { radius: 24.5, thickness: 0.05, axis: [-0.85, 0.3, -0.45], opening: 0.7, weight: 0.9, flatten: 0.9 },
              { radius: 29, thickness: 0.045, axis: [0.2, 0.1, 1], opening: 0.72, weight: 0.7, flatten: 0.85 },
              // A long, faint loop crossing the field (the arc of the deep images).
              { radius: 33, thickness: 0.035, axis: [-0.3, 0.05, -1], opening: 0.86, weight: 0.45, flatten: 0.4 },
            ],
          },
        },
      }),
      discBody({
        name: 'NGC 470',
        seed: 470,
        scale: 0.36,
        starWeight: 0.19,
        frame: { position: [40, -6, -8], orientation: { inclination: -58, positionAngle: 120, spin: 0 } },
        overrides: {
          static: true,
          map: {
            arms: [2, tan(14), 3, 0],
            spur: [0.3, 1.5, 8, 1.5],
            youngEnv: [3.5, 6.5, 19, 25],
            ring: [10.4, 1.15, 0.3, 0.7],
            inner: [0.4, 0.78, 8, 0.8],
            mix: [1, 0.9, 0.9, 0.22],
          },
          orbits: { tanPitch: tan(14) },
          light: { disk: 0.32, young: 0.15, hii: 0.05 },
          stars: { shares: { bulge: 0.2, disk: 0.45, arms: 0.28, highlights: 0.003, nebulae: 0.002, halo: 0.04, satellites: 0 } },
        },
      }),
    ],
  },

  {
    id: 'antennae',
    name: 'Galáxias Antenas',
    altNames: 'NGC 4038 · NGC 4039 · Arp 244',
    classification: 'Par de galáxias em fusão',
    constellation: 'Corvo',
    distance: { lightYears: 45e6, label: '≈ 45 milhões de anos-luz', estimate: false },
    sky: { ra: 180.47089, dec: -18.86762 },
    description:
      'Duas galáxias em plena colisão. O choque dispara uma intensa formação de estrelas — ' +
      'regiões rosadas e aglomerados azuis — e lançou duas longas caudas de maré que lembram ' +
      'as antenas de um inseto. Estado visual representativo (a fusão leva centenas de milhões de anos).',
    sources: [esaHubble('heic0812a'), NED],
    color: '#ffc7b8',
    radius: 30,
    seed: 4038,
    starWeight: 0.75,
    lod: 'Dois discos deformados, região de contato com muitas regiões HII, caudas de maré 3D',
    bodies: [
      discBody({
        name: 'NGC 4038',
        seed: 4038,
        scale: 0.52,
        starWeight: 0.3,
        frame: { position: [-3.4, 0.8, -4.2], orientation: { inclination: 35, positionAngle: 40, spin: 0 } },
        overrides: {
          static: true,
          mapRadius: 34,
          map: {
            arms: [2, tan(22), 2.6, 0.8],
            spur: [0.3, 1.4, 6, 1.4],
            youngEnv: [3, 6, 22, 27],
            ring: [11, 2.6, 0.95, 0.6],
            ringShape: [3, 1, 1.35, 0.75],
            segments: [0.2, -0.6, 0.15, 0.35],
            clouds: [0.5, -0.3, 0.6, 0.1],
            knots: [1.4, 0.48, 0.88, 0.9],
            lanes: [0.5, 5, 1.2, 0],
            inner: [0, 0.78, 8, 0.8],
            dustRing: [10, 1.6, 0.8, 0],
            dustMix: [0.75, 0.55, 0.3, 0.12],
            warp: [0.06, 2.2, 0.32, 0.4],
            deform: [1.4, 0.35, 5, 0.9],
            deformRange: [4, 24, 0, 0],
            mix: [1.1, 1.2, 1.8, 0.25],
          },
          orbits: { tanPitch: tan(22) },
          warp: { amp: 1.2, r0: 5, r1: 25, angle: 0.8 },
          light: { disk: 0.3, young: 0.26, hii: 0.2, dust: 10, oldInner: [1.0, 0.82, 0.62] },
          stars: {
            shares: { bulge: 0.12, disk: 0.38, arms: 0.43, highlights: 0.008, nebulae: 0.008, halo: 0.03, satellites: 0 },
            arms: { scale: 9, inner: 3, outer: 26, associations: 0.45, knotScale: 9, knotInner: 4, knotOuter: 25, spread: 1.2 },
          },
        },
      }),
      discBody({
        name: 'NGC 4039',
        seed: 4039,
        scale: 0.46,
        starWeight: 0.26,
        frame: { position: [4.2, -1, 3.8], orientation: { inclination: -55, positionAngle: -30, spin: 140 } },
        overrides: {
          static: true,
          mapRadius: 34,
          map: {
            arms: [2, tan(20), 2.6, 2.2],
            spur: [0.3, 1.4, 6, 0.4],
            youngEnv: [3, 6, 21, 27],
            ring: [9, 2.4, 0.7, 0.6],
            ringShape: [-2, -1, 1.3, 0.75],
            segments: [0.2, -0.6, 0.15, 0.35],
            clouds: [0.5, -0.3, 0.6, 0.1],
            knots: [1.4, 0.48, 0.88, 0.9],
            lanes: [0.5, 5, 1.2, 0],
            inner: [0, 0.78, 8, 0.8],
            dustRing: [9, 1.6, 0.7, 0],
            dustMix: [0.75, 0.55, 0.3, 0.12],
            warp: [0.06, 2.2, 0.32, 0.4],
            deform: [-1.2, 0.3, 4, 2.5],
            deformRange: [4, 24, 0, 0],
            mix: [1.1, 1.1, 1.6, 0.25],
          },
          orbits: { tanPitch: tan(20) },
          warp: { amp: -1.0, r0: 5, r1: 25, angle: 2.4 },
          light: { disk: 0.3, young: 0.22, hii: 0.18, dust: 10, oldInner: [1.0, 0.82, 0.62] },
          stars: {
            shares: { bulge: 0.14, disk: 0.4, arms: 0.4, highlights: 0.007, nebulae: 0.007, halo: 0.03, satellites: 0 },
            arms: { scale: 9, inner: 3, outer: 26, associations: 0.45, knotScale: 9, knotInner: 4, knotOuter: 25, spread: 1.2 },
          },
        },
      }),
    ],
    // Picture frame: x right, y towards the observer, z down (kpc).
    tidal: {
      starWeight: 0.19,
      brightness: { stars: 0.8, glow: 0.01 },
      glowShare: 0.05,
      streams: [
        {
          // Tail of NGC 4038: leaves to the left, then sweeps down.
          points: [[-8, 0.5, -6], [-16, 2, -7], [-24, 4.5, -2], [-29, 7, 8], [-30, 9, 20], [-27, 10.5, 32], [-22, 11, 42]],
          width: [1.4, 4.2],
          weight: 1,
          young: 0.35,
          knots: 0.04,
          brightness: 1,
          fade: 1.15,
          thickness: 0.5,
        },
        {
          // Tail of NGC 4039: leaves to the right, then sweeps down, longer.
          points: [[8, -1, 6], [16, -3, 7], [23, -5, 13], [27, -7.5, 24], [28, -9, 37], [25, -10, 49], [20, -10.5, 59]],
          width: [1.2, 4.6],
          weight: 1.1,
          young: 0.3,
          knots: 0.04,
          brightness: 0.95,
          fade: 1.2,
          thickness: 0.5,
        },
        {
          // Overlap region: gas compressed between the two discs, full of young clusters.
          points: [[-3, 0.4, -1], [0, 0, 0.5], [2.5, -0.4, 1.5], [4, -0.6, 2]],
          width: [2.2, 2.2],
          weight: 0.6,
          young: 0.85,
          knots: 0.3,
          brightness: 1.1,
          fade: 0.8,
          thickness: 0.35,
        },
      ],
    },
  },

  {
    id: 'arp142',
    name: 'Arp 142',
    altNames: 'NGC 2936 · NGC 2937',
    classification: 'Par em interação',
    constellation: 'Hidra',
    distance: { lightYears: 400e6, label: '≈ 400 milhões de anos-luz', estimate: false },
    sky: { ra: 144.43403, dec: 2.76085 },
    description:
      'NGC 2936, antes uma espiral comum, foi esticada pela gravidade da elíptica NGC 2937: juntas ' +
      'lembram um pinguim guardando seu ovo. O núcleo da espiral forma o “olho” e seus braços ' +
      'deformados, o corpo. Estado visual representativo.',
    sources: [esaHubble('heic1311a'), NED],
    color: '#c9d6ff',
    radius: 30,
    seed: 2936,
    starWeight: 0.6,
    lod: 'Espiral fortemente deformada, elíptica compacta, corrente de maré',
    bodies: [
      discBody({
        name: 'NGC 2936',
        seed: 2936,
        scale: 0.5,
        starWeight: 0.38,
        frame: { position: [-4, 0, -6], orientation: { inclination: 30, positionAngle: 0, spin: 0 } },
        overrides: {
          static: true,
          map: {
            arms: [2, tan(20), 2.6, 0],
            spur: [0.3, 1.4, 6, 1.4],
            youngEnv: [3, 6, 24, 28],
            ring: [10.4, 1.15, 0, 0],
            segments: [0.15, -0.7, 0.15, 0.4],
            clouds: [0.45, -0.3, 0.6, 0.08],
            knots: [1.5, 0.5, 0.9, 1.1],
            lanes: [0.5, 5, 1.3, 0],
            inner: [0, 0.78, 8, 0.8],
            dustRing: [9.8, 0.75, 0, 0],
            dustEnv: [1.5, 3.5, 22, 27],
            warp: [0.05, 2.0, 0.32, 0.4],
            deform: [2.0, 0.9, 7, -1.2],
            deformRange: [3, 26, 0, 0],
            mix: [1.1, 1.25, 1.4, 0.22],
          },
          mapRadius: 60,
          orbits: { tanPitch: tan(20) },
          warp: { amp: 1.5, r0: 6, r1: 26, angle: 1.0 },
          light: {
            bulge: [
              { surface: 6.5, sigma: 0.05, q: 0.9, color: [1.0, 0.97, 0.92] },
              { surface: 1.5, sigma: 0.4, q: 0.85, color: [1.0, 0.92, 0.8] },
              { surface: 0.6, sigma: 1.2, q: 0.75, color: [1.0, 0.88, 0.72] },
            ],
            diskRadius: 29,
            disk: 0.26,
            young: 0.24,
            hii: 0.08,
            dust: 10,
          },
          stars: {
            shares: { bulge: 0.12, disk: 0.4, arms: 0.42, highlights: 0.006, nebulae: 0.004, halo: 0.03, satellites: 0 },
            arms: { scale: 9, inner: 3, outer: 27, associations: 0.4, knotScale: 9, knotInner: 4, knotOuter: 26, spread: 1 },
          },
        },
      }),
      ellipticalBody({
        name: 'NGC 2937',
        seed: 2937,
        starWeight: 0.14,
        frame: { position: [14, -3, 12], orientation: { inclination: 70, positionAngle: 30, spin: 0 } },
        spec: {
          static: true,
          light: {
            bulge: [
              { surface: 6.0, sigma: 0.05, q: 0.85, color: [1.0, 0.96, 0.9] },
              { surface: 1.6, sigma: 0.5, q: 0.8, color: [1.0, 0.9, 0.76] },
              { surface: 0.6, sigma: 1.5, q: 0.78, color: [1.0, 0.87, 0.7] },
              { surface: 0.12, sigma: 3.6, q: 0.78, color: [1.0, 0.86, 0.7] },
            ],
          },
          stars: {
            bulge: { scale: 0.9, max: 8, flattening: 0.78, depth: 0.95, nucleus: 0.03, nucleusRadius: 0.05, temperature: [0.15, 0.27] },
            halo: { inner: 1.5, outer: 14, flattening: 0.85, clusterRadius: 10, globularShare: 0.3 },
          },
        },
      }),
    ],
    tidal: {
      starWeight: 0.08,
      brightness: { stars: 0.75, glow: 0.01 },
      glowShare: 0.05,
      streams: [
        {
          // The "beak and back" of the penguin: material pulled out of the spiral.
          points: [[-14, 1, -14], [-20, 2, -8], [-21, 2.5, 1], [-17, 2, 9], [-10, 1.5, 14], [-2, 1, 16]],
          width: [1.4, 2.6],
          weight: 1,
          young: 0.6,
          knots: 0.06,
          brightness: 1,
          fade: 1,
          thickness: 0.45,
        },
        {
          points: [[6, -0.5, 4], [10, -1.5, 8], [13, -2.5, 11]],
          width: [1.2, 1.8],
          weight: 0.25,
          young: 0.2,
          knots: 0.01,
          brightness: 0.7,
          fade: 1,
          thickness: 0.5,
        },
      ],
    },
  },

  {
    id: 'arp87',
    name: 'Arp 87',
    altNames: 'NGC 3808 · NGC 3808A',
    classification: 'Par em interação',
    constellation: 'Leão',
    distance: {
      lightYears: 330e6,
      label: '≈ 330 milhões de anos-luz',
      estimate: true,
      note: 'estimativa pelo desvio para o vermelho (NED, z = 0,0236; H₀ = 70 km/s/Mpc)',
    },
    sky: { ra: 175.185, dec: 22.43778 },
    description:
      'Duas espirais em interação: a maior, NGC 3808, perdeu gás, poeira e estrelas, que formam um ' +
      'braço envolvendo a companheira menor, NGC 3808A, vista quase de perfil. Estado visual representativo.',
    sources: [NED],
    color: '#cdd9ff',
    radius: 26,
    seed: 3808,
    starWeight: 0.6,
    lod: 'Espiral com anel de formação estelar, companheira de perfil, ponte de matéria',
    bodies: [
      discBody({
        name: 'NGC 3808',
        seed: 3808,
        scale: 0.48,
        starWeight: 0.34,
        frame: { position: [-11, 0, 1], orientation: { inclination: -28, positionAngle: 20, spin: 0 } },
        overrides: {
          static: true,
          mapRadius: 38,
          map: {
            arms: [2, tan(17), 2.8, 0.6],
            spur: [0.3, 1.4, 6, 1.4],
            youngEnv: [3, 6, 23, 27],
            ring: [7.5, 1.6, 0.8, 0.5],
            ringShape: [0, 0, 1.1, 0.6],
            segments: [0.15, -0.6, 0.15, 0.4],
            knots: [1.5, 0.5, 0.9, 1.1],
            lanes: [0.5, 5, 1.3, 0],
            inner: [0, 0.78, 8, 0.8],
            dustRing: [7, 1.2, 0.6, 0],
            warp: [0.05, 1.6, 0.32, 0.35],
            deform: [0.9, 0.25, 4, 0.2],
            deformRange: [8, 26, 0, 0],
            mix: [1.1, 1.15, 1.4, 0.22],
          },
          orbits: { tanPitch: tan(17) },
          light: { disk: 0.28, young: 0.22, hii: 0.1, dust: 10 },
          stars: {
            shares: { bulge: 0.13, disk: 0.4, arms: 0.41, highlights: 0.006, nebulae: 0.004, halo: 0.03, satellites: 0 },
            arms: { scale: 8, inner: 3, outer: 26, associations: 0.4, knotScale: 8, knotInner: 4, knotOuter: 25, spread: 1 },
          },
        },
      }),
      discBody({
        name: 'NGC 3808A',
        seed: 38081,
        scale: 0.3,
        starWeight: 0.16,
        frame: { position: [14, -2, -1], orientation: { inclination: 78, positionAngle: 75, spin: 0 } },
        overrides: {
          static: true,
          map: {
            arms: [2, tan(14), 3, 0],
            ring: [10.4, 1.15, 0.4, 0.7],
            inner: [0.4, 0.78, 8, 0.8],
            diffuseDust: [0.22, 9, 20, 25],
            mix: [1.2, 0.9, 1.0, 0.22],
          },
          orbits: { tanPitch: tan(14) },
          light: { disk: 0.34, young: 0.15, hii: 0.06, dust: 12 },
          stars: { shares: { bulge: 0.2, disk: 0.48, arms: 0.27, highlights: 0.003, nebulae: 0.002, halo: 0.04, satellites: 0 } },
        },
      }),
    ],
    tidal: {
      starWeight: 0.1,
      brightness: { stars: 0.75, glow: 0.01 },
      glowShare: 0.05,
      streams: [
        {
          // Arm torn from NGC 3808 that wraps around the companion.
          points: [[-3, 0.5, -9], [5, 1.5, -10], [13, 2, -8], [20, 1, -3], [21, -1, 4], [16, -3, 8], [9, -3.5, 7]],
          width: [1.0, 1.4],
          weight: 1,
          young: 0.7,
          knots: 0.08,
          brightness: 1,
          fade: 0.7,
          thickness: 0.4,
        },
        {
          // Faint ring of material around NGC 3808A, across its disc.
          points: [[14, -6, -1], [17.5, -2, -4], [14, 2.5, -2], [10.5, -2, 1.5], [14, -6, -1]],
          width: [0.6, 0.6],
          weight: 0.45,
          young: 0.5,
          knots: 0.05,
          brightness: 0.8,
          fade: 0.5,
          thickness: 0.6,
        },
      ],
    },
  },
];

/** Catalog entry by id (case-insensitive), or undefined. */
export function findGalaxy(id) {
  const key = String(id ?? '').toLowerCase();
  return GALAXY_CATALOG.find((entry) => entry.id === key);
}

/**
 * Where a catalog entry sits in the scene: its real direction on the sky at
 * its compressed distance from the starting point.
 */
export function scenePosition(entry) {
  const direction = skyDirection(entry.sky.ra, entry.sky.dec);
  const distance = navigationDistance(entry.distance.lightYears);
  return direction.map((v) => v * distance);
}

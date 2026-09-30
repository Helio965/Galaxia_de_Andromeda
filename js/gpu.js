/**
 * Which graphics processor is the browser actually rendering with?
 *
 * A web page cannot pick the GPU: it can only ask for the fast one
 * (powerPreference: 'high-performance'). On laptops with two GPUs the
 * operating system often hands the browser the integrated one, and with
 * hardware acceleration turned off the browser falls back to the CPU.
 * Knowing it lets the page pick a sensible quality profile and tell the user.
 */

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|mesa offscreen/i;
const MOBILE = /adreno|mali|powervr|apple gpu|img tec|videocore|tegra|xclipse|maleoon/i;
const APPLE_SILICON = /apple m\d/i;
// Intel Arc: "Arc(TM) A770" is a graphics card, "Arc(TM) Graphics" (Meteor/Lunar Lake) is integrated.
const DISCRETE = /nvidia|geforce|quadro|rtx|gtx|titan|radeon rx|radeon pro|firepro|arc(\(tm\))? [ab]\d{3}/i;
const INTEGRATED = /intel|iris|uhd graphics|hd graphics|radeon\(tm\) graphics|radeon graphics|vega \d* ?graphics|radeon \d{3}m\b|arc(\(tm\))? graphics/i;

// Among dedicated cards: which ones comfortably run the full-size galaxy?
const DISCRETE_ULTRA = /rtx|titan|radeon rx ?[5-9]\d{3}|rx ?[67]\d{3}|radeon pro w|arc(\(tm\))? [ab][57]\d{2}/i;
const DISCRETE_WEAK = /\bmx ?\d{3}\b|geforce (gt )?\d{3}m?\b|gt \d{3}\b|radeon r[57]|firepro/i;

/**
 * @returns {{ raw: string, name: string,
 *   kind: 'discrete'|'integrated'|'apple'|'mobile'|'software'|'other',
 *   tier: 'ultra'|'high'|'medium'|'low' }}
 */
export function describeGpu(renderer) {
  const gl = renderer.getContext();
  let raw = '';
  try {
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    raw = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  } catch {
    raw = '';
  }

  // Safari reports every Apple chip as "Apple GPU": on a Mac (fine pointer) it is Apple silicon.
  const finePointer = window.matchMedia?.('(pointer: fine)').matches ?? false;

  let kind = 'other';
  if (SOFTWARE.test(raw)) kind = 'software';
  else if (APPLE_SILICON.test(raw) || (/apple gpu/i.test(raw) && finePointer)) kind = 'apple';
  else if (MOBILE.test(raw)) kind = 'mobile';
  else if (DISCRETE.test(raw) && !/arc(\(tm\))? graphics/i.test(raw)) kind = 'discrete';
  else if (INTEGRATED.test(raw)) kind = 'integrated';

  return {
    raw,
    kind,
    tier: tierFor(kind, raw),
    name: kind === 'software' ? 'CPU / Software Renderer' : cleanName(raw),
  };
}

function tierFor(kind, raw) {
  switch (kind) {
    case 'discrete':
      if (DISCRETE_WEAK.test(raw)) return 'medium';
      return DISCRETE_ULTRA.test(raw) ? 'ultra' : 'high';
    case 'apple':
      return 'high';
    case 'integrated':
      return 'medium';
    case 'mobile':
    case 'software':
      return 'low';
    default:
      return 'high';
  }
}

/**
 * "ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU (0x000025A2) Direct3D11 vs_5_0 ps_5_0, D3D11)"
 * becomes "NVIDIA GeForce RTX 3050 Laptop GPU".
 */
function cleanName(raw) {
  let name = raw;
  if (name.startsWith('ANGLE (') && name.endsWith(')')) {
    const parts = name.slice(7, -1).split(', ');
    name = parts[1] || parts[0];
  }
  return (
    name
      .replace(/^ANGLE Metal Renderer: /, '')
      .replace(/, or similar$/i, '')
      .replace(/\s*\(0x[0-9a-f]+\)/i, '')
      .replace(/\s+(Direct3D|OpenGL|Vulkan|vs_\d).*$/i, '')
      .replace(/\/PCIe.*$/i, '')
      .replace(/\((R|TM)\)/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim() || 'GPU desconhecida'
  );
}

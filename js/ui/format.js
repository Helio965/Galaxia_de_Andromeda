/** Number formatting shared by the interface (Brazilian Portuguese). */

const decimal1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const decimal0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 0 });

/** Scene distance: "132 u", "4,2 u". 1 u ≈ 1 kpc inside a galaxy; compressed between galaxies. */
export function formatSceneDistance(units) {
  return `${units < 10 ? decimal1.format(units) : decimal0.format(units)} u`;
}

/** Speed in scene units per second. */
export function formatSpeed(unitsPerSecond) {
  if (unitsPerSecond < 0.05) return 'parado';
  return `${unitsPerSecond < 10 ? decimal1.format(unitsPerSecond) : decimal0.format(unitsPerSecond)} u/s`;
}

export function formatStars(count) {
  return `≈ ${compact.format(count)}`;
}

export function formatCount(count) {
  return count.toLocaleString('pt-BR');
}

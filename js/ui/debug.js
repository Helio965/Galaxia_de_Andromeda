/**
 * Debug overlay (?debug=1): camera position, mode, active galaxy and level of
 * detail of every galaxy, draw calls, GPU memory objects, stars, frame rate,
 * speed. Refreshed four times a second (cheap).
 */
export function createDebugOverlay() {
  const node = document.getElementById('debug');
  if (!node) return null;
  node.hidden = false;
  let elapsed = 0;
  return {
    update(delta, read) {
      elapsed += delta;
      if (elapsed < 0.25) return;
      elapsed = 0;
      const d = read();
      const p = d.camera.position;
      const lines = [
        `pos   ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`,
        `modo  ${d.mode}${d.phase ? ` · ${d.phase}` : ''}`,
        `ativa ${d.active ?? '—'}   fov ${d.camera.fov.toFixed(1)}°`,
        `vel   ${d.speed.toFixed(2)} u/s   ×${d.multiplier.toFixed(2)}`,
        `fps   ${d.fps.toFixed(1)}   draw ${d.calls}   tri/pts ${d.points}`,
        `mem   geo ${d.geometries}  tex ${d.textures}${d.heap ? `  js ${d.heap} MB` : ''}`,
        `stars ${d.stars.toLocaleString('pt-BR')}   gerando ${d.busy ?? '—'}`,
        'LOD:',
        ...d.lod.map((s) => `  ${s.level} ${s.loaded ? '●' : s.loading ? '◐' : '○'} ${s.name.padEnd(22)} ${s.relative.toFixed(1).padStart(5)}  fade ${s.fade.toFixed(2)}`),
      ];
      node.textContent = lines.join('\n');
    },
  };
}

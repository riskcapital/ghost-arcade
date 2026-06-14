(async () => {
  const layersMod = await import('/src/lib/stores/layers.ts');
  const reg = await import('/src/lib/plugins/registry.ts');
  const gp = await import('/src/lib/input/gamepad.ts');

  const project = layersMod.project;
  const read = () => { let v; const u = project.subscribe(x => v = x); u(); return v; };
  let proj = read();
  let layerId = proj.selectedLayerId || (proj.layers[0] && proj.layers[0].id);
  if (!layerId) {
    project.addLayer('Ghost Pilot', 'media');
    proj = read();
    layerId = proj.selectedLayerId || (proj.layers[proj.layers.length - 1] && proj.layers[proj.layers.length - 1].id);
  }
  if (!layerId) return { ok: false, why: 'could not create/target a layer' };

  const plugin = reg.getPlugin('ghostpilot');
  if (!plugin) return { ok: false, why: 'ghostpilot plugin missing' };

  project.setLayerSource(layerId, {
    id: `plugin-ghostpilot-${layerId}`,
    type: 'effect',
    name: plugin.name,
    src: 'plugin://ghostpilot',
    effectSource: { effectType: plugin.effectType, ...(plugin.defaultSourceParams || {}) },
  });

  gp.startGamepadPolling();
  gp.setKeyboardPilotActive(true);
  return { ok: true, layerId, effectType: plugin.effectType };
})()

<script lang="ts">
  import { selectedLayer, layers, project, scheduleHistorySnapshot, recordDiscreteAction } from '../stores/layers';
  import type { BlendMode } from '../types';
  import type { StrokeType, FillType, AnimationType } from '../drawing/types';
  import EffectParamRow from './EffectParamRow.svelte';

  // The modulation engine identifies the target layer by index into the
  // project's layer array, not by id. Derive it reactively from the
  // currently-selected layer so EffectParamRow can build the right
  // modulation key (`<layerIdx>:edge:<effectId>:<path>`).
  $: layerIdx = $selectedLayer ? $layers.findIndex(l => l.id === $selectedLayer!.id) : -1;

  const strokeTypes: { type: StrokeType; label: string }[] = [
    { type: 'none', label: 'None' },
    { type: 'solid', label: 'Solid' },
    { type: 'glow', label: 'Glow' },
    { type: 'neon', label: 'Neon' },
    { type: 'snake', label: 'Snake' },
    { type: 'rainbow', label: 'Rainbow' },
    { type: 'dashed', label: 'Dashed' },
    { type: 'electric', label: 'Electric' },
    { type: 'pulse', label: 'Pulse' },
    { type: 'scanner', label: 'Scanner' },
    { type: 'fire', label: 'Fire' },
  ];

  const fillTypes: { type: FillType; label: string }[] = [
    { type: 'none', label: 'None' },
    { type: 'solid', label: 'Solid' },
    { type: 'plasma', label: 'Plasma' },
    { type: 'liquid', label: 'Liquid' },
    { type: 'fire', label: 'Fire' },
    { type: 'electric', label: 'Electric' },
    { type: 'holographic', label: 'Holographic' },
    { type: 'noise', label: 'Noise' },
    { type: 'gradient', label: 'Gradient' },
  ];

  const animationTypes: { type: AnimationType; label: string }[] = [
    { type: 'none', label: 'None' },
    { type: 'concentric', label: 'Concentric' },
    { type: 'breathe', label: 'Breathe' },
    { type: 'rotate', label: 'Rotate' },
    { type: 'radiate', label: 'Radiate' },
    { type: 'ripple', label: 'Ripple' },
    { type: 'wave', label: 'Wave' },
    { type: 'glitch', label: 'Glitch' },
  ];

  const blendModes: { value: BlendMode; label: string }[] = [
    { value: 'normal', label: 'Normal' },
    { value: 'add', label: 'Add' },
    { value: 'multiply', label: 'Multiply' },
    { value: 'screen', label: 'Screen' },
    { value: 'overlay', label: 'Overlay' },
    { value: 'difference', label: 'Difference' },
    { value: 'exclusion', label: 'Exclusion' },
    { value: 'softlight', label: 'Soft Light' },
    { value: 'hardlight', label: 'Hard Light' },
    { value: 'color-dodge', label: 'Color Dodge' },
    { value: 'color-burn', label: 'Color Burn' },
    { value: 'lighten', label: 'Lighten' },
    { value: 'darken', label: 'Darken' },
  ];

  // Helper to convert RGBA array to hex
  function rgbaToHex(c: [number, number, number, number]): string {
    const r = Math.round(c[0] * 255).toString(16).padStart(2, '0');
    const g = Math.round(c[1] * 255).toString(16).padStart(2, '0');
    const b = Math.round(c[2] * 255).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }

  // Helper to convert hex to RGBA array
  function hexToRgba(hex: string, a: number = 1): [number, number, number, number] {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b, a];
  }

  function updateEffect(effectId: string, updates: Record<string, unknown>) {
    if (!$selectedLayer) return;
    project.updateEdgeEffect($selectedLayer.id, effectId, updates as any);
    scheduleHistorySnapshot();
  }

  function updateStroke(effectId: string, strokeUpdates: Record<string, unknown>) {
    const effect = $selectedLayer?.edgeEffects?.effects.find(e => e.id === effectId);
    if (!effect || !$selectedLayer) return;
    project.updateEdgeEffect($selectedLayer.id, effectId, {
      stroke: { ...effect.stroke, ...strokeUpdates },
    });
    scheduleHistorySnapshot();
  }

  function setStrokeType(effectId: string, type: StrokeType) {
    if (!$selectedLayer) return;
    const defaults: Record<string, any> = {
      none: { type: 'none' },
      solid: { type: 'solid', color: [1, 1, 1, 1], width: 3 },
      glow: { type: 'glow', color: [0, 1, 0.5, 1], width: 3, glowSize: 15, glowIntensity: 1, pulseSpeed: 1 },
      neon: { type: 'neon', color: [1, 0, 1, 1], width: 2, glowSize: 20, glowIntensity: 1.5, pulseSpeed: 0.5, flickerSpeed: 3 },
      snake: { type: 'snake', color: [0, 1, 0.5, 1], width: 3, length: 0.3, speed: 1, tailFade: true, headGlow: true, bidirectional: false, snakeCount: 1 },
      rainbow: { type: 'rainbow', color: [1, 1, 1, 1], width: 3, speed: 1 },
      dashed: { type: 'dashed', color: [1, 1, 1, 1], width: 2, dashLength: 0.2, gapLength: 0.1, speed: 0.5 },
      electric: { type: 'electric', color: [0.3, 0.5, 1, 1], width: 2, arcIntensity: 1, speed: 1 },
      pulse: { type: 'pulse', color: [0, 1, 1, 1], width: 3, pulseCount: 3, speed: 1, fadeLength: 0.15 },
      scanner: { type: 'scanner', color: [0, 1, 0, 1], width: 3, beamWidth: 0.1, trailLength: 0.3, speed: 1 },
      fire: { type: 'fire', color: [1, 0.5, 0, 1], width: 4, speed: 1 },
    };
    project.updateEdgeEffect($selectedLayer.id, effectId, { stroke: defaults[type] || { type } });
    recordDiscreteAction();
  }

  function updateFill(effectId: string, fillUpdates: Record<string, unknown>) {
    const effect = $selectedLayer?.edgeEffects?.effects.find(e => e.id === effectId);
    if (!effect || !$selectedLayer) return;
    project.updateEdgeEffect($selectedLayer.id, effectId, {
      fill: { ...effect.fill, ...fillUpdates },
    });
    scheduleHistorySnapshot();
  }

  function updateAnimation(effectId: string, animUpdates: Record<string, unknown>) {
    const effect = $selectedLayer?.edgeEffects?.effects.find(e => e.id === effectId);
    if (!effect || !$selectedLayer) return;
    project.updateEdgeEffect($selectedLayer.id, effectId, {
      animation: { ...effect.animation, ...animUpdates },
    });
    scheduleHistorySnapshot();
  }

  function setFillType(effectId: string, type: FillType) {
    if (!$selectedLayer) return;
    const defaults: Record<string, any> = {
      none: { type: 'none' },
      solid: { type: 'solid', color: [1, 1, 1, 1], opacity: 0.5 },
      plasma: { type: 'plasma', scale: 3, complexity: 3, palette: 'neon', speed: 1 },
      liquid: { type: 'liquid', color: [0, 0.5, 1, 1], viscosity: 0.5, turbulence: 0.5, speed: 1, metallic: 0.5 },
      fire: { type: 'fire', intensity: 1, turbulence: 0.5, speed: 1, palette: 'orange' },
      electric: { type: 'electric', color: [0.3, 0.5, 1, 1], intensity: 1, arcCount: 5, speed: 1 },
      holographic: { type: 'holographic', hueShift: 0.5, scanlines: true, flicker: 0.3 },
      noise: { type: 'noise', color1: [0, 0, 0, 1], color2: [1, 1, 1, 1], scale: 5, octaves: 4, speed: 0.5 },
      gradient: { type: 'gradient', stops: [{ color: [1, 0, 0, 1], position: 0 }, { color: [0, 0, 1, 1], position: 1 }], angle: 0, gradientType: 'linear', speed: 0 },
    };
    project.updateEdgeEffect($selectedLayer.id, effectId, { fill: defaults[type] || { type } });
    recordDiscreteAction();
  }

  function setAnimationType(effectId: string, type: AnimationType) {
    if (!$selectedLayer) return;
    const defaults: Record<string, any> = {
      none: { type: 'none' },
      concentric: { type: 'concentric', count: 5, spacing: 0.04, speed: 1, direction: 'out', fadeOut: true, scaleVariation: 0 },
      breathe: { type: 'breathe', speed: 1, minScale: 0.8, maxScale: 1.2 },
      rotate: { type: 'rotate', speed: 1, direction: 'cw' },
      radiate: { type: 'radiate', rays: 8, speed: 1 },
      ripple: { type: 'ripple', speed: 1, wavelength: 0.1, amplitude: 0.02 },
      wave: { type: 'wave', speed: 1, wavelength: 0.2, amplitude: 0.03 },
      glitch: { type: 'glitch', intensity: 0.5, speed: 2, rgbSplit: true },
    };
    project.updateEdgeEffect($selectedLayer.id, effectId, { animation: defaults[type] || { type } });
    recordDiscreteAction();
  }

  let expandedEffectId: string | null = null;
</script>

{#if $selectedLayer}
  <div class="edge-effects-panel">
    <div class="section-header-row">
      <span class="section-title">Edge Effects</span>
      {#if !$selectedLayer.edgeEffects}
        <button class="btn-enable" onclick={() => project.enableEdgeEffects($selectedLayer.id)}>
          Enable
        </button>
      {:else}
        <label class="toggle-label">
          <input type="checkbox" checked={$selectedLayer.edgeEffects.enabled}
            onchange={() => project.toggleEdgeEffectsEnabled($selectedLayer.id)} />
          <span>Active</span>
        </label>
        <button class="btn-disable" onclick={() => project.disableEdgeEffects($selectedLayer.id)}>
          &times;
        </button>
      {/if}
    </div>

    {#if $selectedLayer.edgeEffects?.enabled}
      {#each $selectedLayer.edgeEffects.effects as effect, idx (effect.id)}
        <div class="effect-card" class:disabled={!effect.enabled}>
          <!-- Effect header -->
          <div class="effect-header">
            <input type="checkbox" checked={effect.enabled}
              onchange={() => updateEffect(effect.id, { enabled: !effect.enabled })} />
            <button class="effect-title" onclick={() => expandedEffectId = expandedEffectId === effect.id ? null : effect.id}>
              Effect {idx + 1}
              <span class="expand-icon">{expandedEffectId === effect.id ? '-' : '+'}</span>
            </button>
            <!-- Blend mode -->
            <select class="blend-select" value={effect.blendMode}
              onchange={(e) => updateEffect(effect.id, { blendMode: (e.target as HTMLSelectElement).value })}>
              {#each blendModes as bm}
                <option value={bm.value}>{bm.label}</option>
              {/each}
            </select>
            <!-- Opacity (kept on the header row as a quick slider; the
                 modulation-aware version with dropdown sits in the
                 expanded controls when the effect is opened). -->
            <input type="range" class="opacity-slider" min="0" max="1" step="0.05"
              value={effect.opacity}
              oninput={(e) => updateEffect(effect.id, { opacity: parseFloat((e.target as HTMLInputElement).value) })} />
            <button class="btn-remove" onclick={() => project.removeEdgeEffect($selectedLayer.id, effect.id)}>&times;</button>
          </div>

          {#if expandedEffectId === effect.id}
            <div class="effect-controls">
              <!-- STROKE SECTION -->
              <div class="subsection">
                <span class="subsection-label">Outline</span>
                <div class="control-row">
                  <span class="control-label">Type</span>
                  <select value={effect.stroke.type}
                    onchange={(e) => setStrokeType(effect.id, (e.target as HTMLSelectElement).value as StrokeType)}>
                    {#each strokeTypes as st}
                      <option value={st.type}>{st.label}</option>
                    {/each}
                  </select>
                </div>

                {#if effect.stroke.type !== 'none'}
                  {#if 'color' in effect.stroke}
                    <div class="control-row">
                      <span class="control-label">Color</span>
                      <input type="color" value={rgbaToHex((effect.stroke as any).color)}
                        oninput={(e) => updateStroke(effect.id, { color: hexToRgba((e.target as HTMLInputElement).value, (effect.stroke as any).color?.[3] ?? 1) })} />
                    </div>
                  {/if}
                  <!-- Layer opacity (top-level, not nested under stroke) —
                       exposed here so users can modulate it via audio
                       without leaving the expanded effect controls. -->
                  <EffectParamRow label="Opacity" min={0} max={1} step={0.01}
                    layerIndex={layerIdx} effectId={effect.id} paramName="opacity" effectKind="edge"
                    value={effect.opacity}
                    displayValue={(v) => (v * 100).toFixed(0) + '%'}
                    onChange={(v) => updateEffect(effect.id, { opacity: v })} />
                  {#if 'width' in effect.stroke}
                    <EffectParamRow label="Width" min={1} max={20} step={0.5}
                      layerIndex={layerIdx} effectId={effect.id} paramName="stroke.width" effectKind="edge"
                      value={effect.stroke.width}
                      displayValue={(v) => v.toFixed(1)}
                      onChange={(v) => updateStroke(effect.id, { width: v })} />
                  {/if}
                  {#if (effect.stroke.type === 'glow' || effect.stroke.type === 'neon') && 'glowSize' in effect.stroke}
                    <EffectParamRow label="Glow Size" min={5} max={50} step={1}
                      layerIndex={layerIdx} effectId={effect.id} paramName="stroke.glowSize" effectKind="edge"
                      value={(effect.stroke as any).glowSize}
                      displayValue={(v) => v.toFixed(0)}
                      onChange={(v) => updateStroke(effect.id, { glowSize: v })} />
                    <EffectParamRow label="Intensity" min={0.1} max={3} step={0.1}
                      layerIndex={layerIdx} effectId={effect.id} paramName="stroke.glowIntensity" effectKind="edge"
                      value={(effect.stroke as any).glowIntensity}
                      displayValue={(v) => v.toFixed(1)}
                      onChange={(v) => updateStroke(effect.id, { glowIntensity: v })} />
                    <EffectParamRow label="Pulse" min={0} max={3} step={0.1}
                      layerIndex={layerIdx} effectId={effect.id} paramName="stroke.pulseSpeed" effectKind="edge"
                      value={(effect.stroke as any).pulseSpeed}
                      displayValue={(v) => v.toFixed(1)}
                      onChange={(v) => updateStroke(effect.id, { pulseSpeed: v })} />
                  {/if}
                  {#if effect.stroke.type === 'snake' && 'length' in effect.stroke}
                    <EffectParamRow label="Length" min={0.05} max={0.95} step={0.05}
                      layerIndex={layerIdx} effectId={effect.id} paramName="stroke.length" effectKind="edge"
                      value={(effect.stroke as any).length}
                      displayValue={(v) => (v * 100).toFixed(0) + '%'}
                      onChange={(v) => updateStroke(effect.id, { length: v })} />
                    <EffectParamRow label="Speed" min={0.1} max={3} step={0.1}
                      layerIndex={layerIdx} effectId={effect.id} paramName="stroke.speed" effectKind="edge"
                      value={(effect.stroke as any).speed}
                      displayValue={(v) => v.toFixed(1) + 'x'}
                      onChange={(v) => updateStroke(effect.id, { speed: v })} />
                    <EffectParamRow label="Snakes" min={1} max={8} step={1}
                      layerIndex={layerIdx} effectId={effect.id} paramName="stroke.snakeCount" effectKind="edge"
                      value={(effect.stroke as any).snakeCount}
                      displayValue={(v) => v.toFixed(0)}
                      onChange={(v) => updateStroke(effect.id, { snakeCount: Math.round(v) })} />
                  {/if}
                  {#if effect.stroke.type === 'electric' && 'arcIntensity' in effect.stroke}
                    <EffectParamRow label="Arc" min={0.1} max={2} step={0.1}
                      layerIndex={layerIdx} effectId={effect.id} paramName="stroke.arcIntensity" effectKind="edge"
                      value={(effect.stroke as any).arcIntensity}
                      displayValue={(v) => v.toFixed(1)}
                      onChange={(v) => updateStroke(effect.id, { arcIntensity: v })} />
                  {/if}
                  {#if effect.stroke.type === 'pulse'}
                    <EffectParamRow label="Pulses" min={1} max={8} step={1}
                      layerIndex={layerIdx} effectId={effect.id} paramName="stroke.pulseCount" effectKind="edge"
                      value={(effect.stroke as any).pulseCount ?? 3}
                      displayValue={(v) => v.toFixed(0)}
                      onChange={(v) => updateStroke(effect.id, { pulseCount: Math.round(v) })} />
                  {/if}
                  {#if effect.stroke.type === 'scanner' && 'beamWidth' in effect.stroke}
                    <EffectParamRow label="Beam" min={0.02} max={0.3} step={0.01}
                      layerIndex={layerIdx} effectId={effect.id} paramName="stroke.beamWidth" effectKind="edge"
                      value={(effect.stroke as any).beamWidth}
                      displayValue={(v) => (v * 100).toFixed(0) + '%'}
                      onChange={(v) => updateStroke(effect.id, { beamWidth: v })} />
                    <EffectParamRow label="Trail" min={0.05} max={0.8} step={0.05}
                      layerIndex={layerIdx} effectId={effect.id} paramName="stroke.trailLength" effectKind="edge"
                      value={(effect.stroke as any).trailLength}
                      displayValue={(v) => (v * 100).toFixed(0) + '%'}
                      onChange={(v) => updateStroke(effect.id, { trailLength: v })} />
                  {/if}
                  {#if 'speed' in effect.stroke && (effect.stroke.type as string) !== 'glow' && (effect.stroke.type as string) !== 'neon' && effect.stroke.type !== 'snake'}
                    <EffectParamRow label="Speed" min={0.1} max={3} step={0.1}
                      layerIndex={layerIdx} effectId={effect.id} paramName="stroke.speed" effectKind="edge"
                      value={(effect.stroke as any).speed}
                      displayValue={(v) => v.toFixed(1) + 'x'}
                      onChange={(v) => updateStroke(effect.id, { speed: v })} />
                  {/if}
                {/if}
              </div>

              <!-- FILL SECTION -->
              <div class="subsection">
                <span class="subsection-label">Fill</span>
                <div class="control-row">
                  <span class="control-label">Type</span>
                  <select value={effect.fill.type}
                    onchange={(e) => setFillType(effect.id, (e.target as HTMLSelectElement).value as FillType)}>
                    {#each fillTypes as ft}
                      <option value={ft.type}>{ft.label}</option>
                    {/each}
                  </select>
                </div>

                {#if effect.fill.type === 'solid' && 'color' in effect.fill}
                  <div class="control-row">
                    <span class="control-label">Color</span>
                    <input type="color" value={rgbaToHex((effect.fill as any).color)}
                      oninput={(e) => updateFill(effect.id, { color: hexToRgba((e.target as HTMLInputElement).value) })} />
                  </div>
                  <EffectParamRow label="Opacity" min={0} max={1} step={0.05}
                    layerIndex={layerIdx} effectId={effect.id} paramName="fill.opacity" effectKind="edge"
                    value={(effect.fill as any).opacity ?? 1}
                    displayValue={(v) => (v * 100).toFixed(0) + '%'}
                    onChange={(v) => updateFill(effect.id, { opacity: v })} />
                {/if}
                {#if effect.fill.type !== 'none' && effect.fill.type !== 'solid' && 'speed' in effect.fill}
                  <EffectParamRow label="Speed" min={0.1} max={3} step={0.1}
                    layerIndex={layerIdx} effectId={effect.id} paramName="fill.speed" effectKind="edge"
                    value={(effect.fill as any).speed}
                    displayValue={(v) => v.toFixed(1) + 'x'}
                    onChange={(v) => updateFill(effect.id, { speed: v })} />
                {/if}
                {#if effect.fill.type === 'plasma' && 'scale' in effect.fill}
                  <EffectParamRow label="Scale" min={1} max={10} step={0.5}
                    layerIndex={layerIdx} effectId={effect.id} paramName="fill.scale" effectKind="edge"
                    value={(effect.fill as any).scale}
                    displayValue={(v) => v.toFixed(1)}
                    onChange={(v) => updateFill(effect.id, { scale: v })} />
                {/if}
                {#if effect.fill.type === 'liquid' && 'viscosity' in effect.fill}
                  <EffectParamRow label="Viscosity" min={0.1} max={2} step={0.1}
                    layerIndex={layerIdx} effectId={effect.id} paramName="fill.viscosity" effectKind="edge"
                    value={(effect.fill as any).viscosity}
                    displayValue={(v) => v.toFixed(1)}
                    onChange={(v) => updateFill(effect.id, { viscosity: v })} />
                {/if}
              </div>

              <!-- ANIMATION SECTION -->
              <div class="subsection">
                <span class="subsection-label">Animation</span>
                <div class="control-row">
                  <span class="control-label">Type</span>
                  <select value={effect.animation.type}
                    onchange={(e) => setAnimationType(effect.id, (e.target as HTMLSelectElement).value as AnimationType)}>
                    {#each animationTypes as at}
                      <option value={at.type}>{at.label}</option>
                    {/each}
                  </select>
                </div>

                {#if effect.animation.type === 'concentric' && 'count' in effect.animation}
                  <div class="control-row">
                    <span class="control-label">Direction</span>
                    <select value={(effect.animation as any).direction || 'out'}
                      onchange={(e) => updateEffect(effect.id, { animation: { ...effect.animation, direction: (e.target as HTMLSelectElement).value } })}>
                      <option value="in">Internal</option>
                      <option value="out">External</option>
                      <option value="both">Both</option>
                    </select>
                  </div>
                  <EffectParamRow label="Count" min={2} max={20} step={1}
                    layerIndex={layerIdx} effectId={effect.id} paramName="animation.count" effectKind="edge"
                    value={(effect.animation as any).count}
                    displayValue={(v) => v.toFixed(0)}
                    onChange={(v) => updateAnimation(effect.id, { count: Math.round(v) })} />
                  <EffectParamRow label="Spacing" min={0.01} max={0.1} step={0.005}
                    layerIndex={layerIdx} effectId={effect.id} paramName="animation.spacing" effectKind="edge"
                    value={(effect.animation as any).spacing}
                    displayValue={(v) => (v * 100).toFixed(0) + '%'}
                    onChange={(v) => updateAnimation(effect.id, { spacing: v })} />
                {/if}
                {#if effect.animation.type !== 'none' && 'speed' in effect.animation}
                  <EffectParamRow label="Speed" min={0.1} max={3} step={0.1}
                    layerIndex={layerIdx} effectId={effect.id} paramName="animation.speed" effectKind="edge"
                    value={(effect.animation as any).speed}
                    displayValue={(v) => v.toFixed(1) + 'x'}
                    onChange={(v) => updateAnimation(effect.id, { speed: v })} />
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {/each}

      <button class="btn-add-effect" onclick={() => project.addEdgeEffect($selectedLayer.id)}>
        + Add Effect
      </button>
    {/if}
  </div>
{/if}

<style>
  .edge-effects-panel {
    padding: 8px 0;
    border-top: 1px solid #333;
  }

  .section-header-row {
    display: flex;
    align-items: center;
    gap: 8px;
    /* Reduced left padding from 12 → 0 so this title's left edge lines
       up with the LAYER EFFECTS title (which sits at padding 4 0). */
    padding: 4px 0;
  }

  .section-title {
    font-size: 12px;
    font-weight: 600;
    /* Match LAYER EFFECTS accent — was orange. Both effect surfaces
       read as sibling sections of the layer inspector. */
    color: var(--ga-violet, #9b87f5);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex: 1;
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-muted, #888);
    cursor: pointer;
  }

  .toggle-label input { width: 14px; height: 14px; }

  .btn-enable {
    background: #333;
    color: #ff9800;
    border: 1px solid #ff9800;
    padding: 2px 10px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  }
  .btn-enable:hover { background: #ff9800; color: #000; }

  .btn-disable {
    background: none;
    border: none;
    color: #666;
    cursor: pointer;
    font-size: 15px;
    padding: 0 4px;
  }
  .btn-disable:hover { color: #f44; }

  .effect-card {
    margin: 4px 8px;
    border: 1px solid #333;
    border-radius: 6px;
    overflow: hidden;
  }
  .effect-card.disabled { opacity: 0.5; }

  .effect-header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: #1a1a1c;
  }
  .effect-header input[type="checkbox"] { width: 14px; height: 14px; flex-shrink: 0; }

  .effect-title {
    flex: 1;
    background: none;
    border: none;
    color: var(--text-primary, #ccc);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    padding: 2px 0;
    display: flex;
    justify-content: space-between;
  }
  .effect-title:hover { color: #fff; }

  .expand-icon { color: #666; font-size: 15px; }

  .blend-select {
    width: 75px;
    background: #333;
    color: var(--text-primary, #ccc);
    border: 1px solid #444;
    border-radius: 3px;
    font-size: 11px;
    padding: 2px;
  }

  .opacity-slider {
    width: 40px;
    accent-color: #ff9800;
  }

  .btn-remove {
    background: none;
    border: none;
    color: #666;
    cursor: pointer;
    font-size: 15px;
    padding: 0 2px;
    flex-shrink: 0;
  }
  .btn-remove:hover { color: #f44; }

  .effect-controls {
    padding: 6px 8px;
    background: #111113;
  }

  .subsection {
    margin-bottom: 8px;
  }

  .subsection-label {
    font-size: 11px;
    font-weight: 600;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    display: block;
    margin-bottom: 4px;
  }

  .control-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }

  .control-label {
    width: 60px;
    font-size: 11px;
    color: #777;
    flex-shrink: 0;
  }

  .control-row input[type="range"] {
    flex: 1;
    accent-color: #ff9800;
    height: 14px;
  }

  .control-row input[type="color"] {
    width: 28px;
    height: 22px;
    border: 1px solid #555;
    border-radius: 3px;
    padding: 0;
    cursor: pointer;
  }

  .control-row select {
    flex: 1;
    background: #222;
    color: var(--text-primary, #ccc);
    border: 1px solid #444;
    padding: 3px 6px;
    border-radius: 3px;
    font-size: 11px;
  }

  .control-value {
    width: 38px;
    text-align: right;
    font-size: 10px;
    color: #555;
    flex-shrink: 0;
  }

  .btn-add-effect {
    display: block;
    width: calc(100% - 16px);
    margin: 6px 8px;
    padding: 5px;
    background: #222;
    color: var(--text-muted, #888);
    border: 1px dashed #444;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
    text-align: center;
  }
  .btn-add-effect:hover { color: #ff9800; border-color: #ff9800; }
</style>

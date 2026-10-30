<script lang="ts">
  import { layerSequencer } from '../stores/layerSequencer';
  import { layers } from '../stores/layers';
  import { audioStore } from '../stores/audio';
  import type { SequencerPresetMode, SequencerSubdivision } from '../types';

  // Reactive state from store
  $: state = $layerSequencer;
  $: allLayers = $layers;
  $: pattern = state.pattern;
  $: config = state.config;
  $: currentStep = state.currentStep;
  $: isPlaying = state.isPlaying;
  $: isOpen = state.isOpen;
  $: stepCount = pattern.stepCount;
  $: stepIndices = Array.from({ length: stepCount }, (_, i) => i);

  function toggleTray() {
    layerSequencer.toggleOpen();
  }

  function toggleCell(stepIdx: number, layerId: string) {
    layerSequencer.toggleCell(stepIdx, layerId);
  }

  function applyPreset(mode: SequencerPresetMode) {
    const ids = allLayers.map(l => l.id);
    layerSequencer.generatePattern(mode, ids);
  }

  function onPresetChange(e: Event) {
    const mode = (e.target as HTMLSelectElement).value as SequencerPresetMode;
    if (mode === 'custom') {
      layerSequencer.updateConfig({ presetMode: 'custom' });
    } else {
      applyPreset(mode);
    }
  }

  function onStepCountChange(e: Event) {
    layerSequencer.setStepCount(parseInt((e.target as HTMLSelectElement).value));
  }

  function onTimingModeChange(mode: 'beat' | 'fixed') {
    layerSequencer.updateConfig({ timingMode: mode });
  }

  function onBPMChange(e: Event) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    if (val >= 30 && val <= 300) layerSequencer.updateConfig({ bpm: val });
  }

  function onSubdivisionChange(e: Event) {
    layerSequencer.updateConfig({ subdivision: parseInt((e.target as HTMLSelectElement).value) as SequencerSubdivision });
  }

  function onFixedDurationChange(e: Event) {
    layerSequencer.updateConfig({ fixedStepDuration: parseFloat((e.target as HTMLSelectElement).value) });
  }

  function onCrossfadeToggle() {
    layerSequencer.updateConfig({ crossfadeEnabled: !config.crossfadeEnabled });
  }

  function onCrossfadeDurationChange(e: Event) {
    layerSequencer.updateConfig({ crossfadeDuration: parseFloat((e.target as HTMLSelectElement).value) });
  }

  function onLoopToggle() {
    layerSequencer.updateConfig({ loop: !config.loop });
  }

  function onRandomDensityChange(e: Event) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    layerSequencer.updateConfig({ randomDensity: val });
    if (config.presetMode === 'random') applyPreset('random');
  }

  function tapTempo() {
    audioStore.tapTempo();
    setTimeout(() => {
      const a = $audioStore;
      if (a.bpm > 0) layerSequencer.updateConfig({ bpm: a.bpm });
    }, 50);
  }

  // Truncate layer name for row label
  function truncName(name: string, maxLen = 10): string {
    return name.length > maxLen ? name.slice(0, maxLen) + '\u2026' : name;
  }
</script>

<!-- Toggle Button -->
<button data-help-page="clip-launcher" class="seq-toggle" class:open={isOpen} onclick={toggleTray}>
  <span class="toggle-icon">{isOpen ? '\u25BC' : '\u25B2'}</span>
  <span class="toggle-label">Sequencer</span>
</button>

<!-- Slide-up Tray -->
{#if isOpen}
  <div data-help-page="clip-launcher" class="seq-tray">
    <!-- Header -->
    <div class="seq-header">
      <div class="seq-header-left">
        <span class="seq-title">Sequencer</span>
        <select class="seq-select" value={config.presetMode} onchange={onPresetChange}>
          <option value="custom">Custom</option>
          <option value="snake">Snake</option>
          <option value="everyOther">Every other</option>
          <option value="random">Random</option>
        </select>
        {#if config.presetMode === 'random'}
          <input class="seq-input seq-density" type="range" min="0.1" max="0.9" step="0.1"
            value={config.randomDensity} oninput={onRandomDensityChange}
            title="Density: {Math.round(config.randomDensity * 100)}%" />
        {/if}
        <select class="seq-select" value={stepCount} onchange={onStepCountChange}>
          <option value={4}>4</option>
          <option value={8}>8</option>
          <option value={16}>16</option>
          <option value={32}>32</option>
          <option value={48}>48</option>
        </select>
        <span class="seq-steps-label">steps</span>
      </div>

      <div class="seq-header-center">
        <button class="seq-btn seq-play" onclick={() => isPlaying ? layerSequencer.pause() : layerSequencer.play()} title={isPlaying ? 'Pause' : 'Play'}>
          {#if isPlaying}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
          {/if}
        </button>
        <button class="seq-btn" onclick={() => layerSequencer.stop()} title="Stop">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
        </button>
        <label class="seq-loop-label" title="Loop">
          <input type="checkbox" checked={config.loop} onchange={onLoopToggle} />
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
            <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
          </svg>
        </label>
        <button class="seq-btn seq-clear" onclick={() => layerSequencer.clearPattern()} title="Clear">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
        </button>
        <span class="seq-step-display">{currentStep + 1}<span class="seq-step-sep">/</span>{stepCount}</span>
      </div>

      <div class="seq-header-right">
        <div class="seq-timing-toggle">
          <button class="seq-timing-btn" class:active={config.timingMode === 'beat'} onclick={() => onTimingModeChange('beat')}>Beat</button>
          <button class="seq-timing-btn" class:active={config.timingMode === 'fixed'} onclick={() => onTimingModeChange('fixed')}>Fixed</button>
        </div>
        {#if config.timingMode === 'beat'}
          <input class="seq-input seq-bpm" type="number" min="30" max="300" value={config.bpm} onchange={onBPMChange} title="BPM" />
          <button class="seq-btn seq-tap" onclick={tapTempo} title="Tap tempo">Tap</button>
          <select class="seq-select seq-sub" value={config.subdivision} onchange={onSubdivisionChange}>
            <option value={1}>1/4</option>
            <option value={2}>1/8</option>
            <option value={4}>1/16</option>
          </select>
        {:else}
          <select class="seq-select" value={config.fixedStepDuration} onchange={onFixedDurationChange}>
            <option value={0.25}>0.25s</option>
            <option value={0.5}>0.5s</option>
            <option value={1}>1s</option>
            <option value={2}>2s</option>
            <option value={5}>5s</option>
            <option value={10}>10s</option>
          </select>
        {/if}
        <label class="seq-xfade-label" title="Crossfade">
          <input type="checkbox" checked={config.crossfadeEnabled} onchange={onCrossfadeToggle} />
          Xfade
        </label>
        {#if config.crossfadeEnabled}
          <select class="seq-select seq-xfade-dur" value={config.crossfadeDuration} onchange={onCrossfadeDurationChange}>
            <option value={0.1}>0.1s</option>
            <option value={0.2}>0.2s</option>
            <option value={0.3}>0.3s</option>
            <option value={0.5}>0.5s</option>
            <option value={1.0}>1.0s</option>
            <option value={2.0}>2.0s</option>
          </select>
        {/if}
      </div>
    </div>

    <!-- Horizontal Grid: rows = layers, columns = steps -->
    <div class="seq-grid-container">
      {#if allLayers.length === 0}
        <div class="seq-empty">No layers. Add layers to use the sequencer.</div>
      {:else}
        <div class="seq-grid" style="grid-template-columns: 80px repeat({stepCount}, 28px); grid-template-rows: 20px repeat({allLayers.length}, 26px);">
          <!-- Top-left corner (sticky) -->
          <div class="seq-corner"></div>
          <!-- Step number headers (top row) -->
          {#each stepIndices as stepIdx}
            <div class="seq-step-header" class:current={stepIdx === currentStep}>{stepIdx + 1}</div>
          {/each}

          <!-- Layer rows -->
          {#each allLayers as layer, layerIdx}
            {@const isContinuous = !!pattern.continuousLayers?.[layer.id]}
            <!-- Layer name (sticky left) + continuous-mode toggle -->
            <div class="seq-layer-label" title={layer.name}>
              <span class="seq-layer-dot" style="background: {layer.visible ? 'var(--ga-coral, #ff6f5e)' : 'var(--ga-ink-3, #333)'}"></span>
              <button
                class="seq-cont-btn"
                class:active={isContinuous}
                onclick={(e) => { e.stopPropagation(); layerSequencer.toggleContinuous(layer.id); }}
                title={isContinuous
                  ? 'Continuous mode ON \u2014 cells gate alpha; shader keeps running. Click to disable.'
                  : 'Continuous mode OFF \u2014 cells fully gate the layer. Click to keep shader running while cells gate alpha.'}
                aria-pressed={isContinuous}
              >∞</button>
              <span class="seq-layer-name">{truncName(layer.name)}</span>
            </div>
            <!-- Step cells for this layer -->
            {#each stepIndices as stepIdx}
              {@const active = !!pattern.steps[stepIdx]?.activeLayers[layer.id]}
              {@const isCurrent = stepIdx === currentStep}
              <button
                class="seq-cell"
                class:active
                class:current={isCurrent}
                class:continuous={isContinuous}
                onclick={() => toggleCell(stepIdx, layer.id)}
                title="{layer.name} \u2014 Step {stepIdx + 1}"
              ></button>
            {/each}
          {/each}
        </div>

        <!-- (playhead line removed — current step highlighted green in grid) -->
      {/if}
    </div>
  </div>
{/if}

<style>
  /* ═══════════════════════════════════
     TOGGLE BUTTON
     ═══════════════════════════════════ */
  .seq-toggle {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--ga-bar, #111114);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-0, #ddd);
    height: var(--ga-control-h, 26px);
    padding: 0 12px;
    border-radius: var(--ga-r-pill, 999px);
    cursor: pointer;
    transition: all 0.2s ease;
    z-index: 100;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    font-family: inherit;
  }
  .seq-toggle:hover { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); }
  .seq-toggle.open { border-color: var(--ga-selection-line, #5278ff); background: var(--ga-selection-bg, #1f3170); color: var(--ga-selection-ink, #e0e8ff); }
  .toggle-icon { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #888); }
  .toggle-label { font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-control, 600); }

  /* ═══════════════════════════════════
     TRAY PANEL
     ═══════════════════════════════════ */
  .seq-tray {
    position: fixed;
    bottom: var(--ga-bottom-rail-offset, 74px); left: 0; right: 0;
    height: 280px;
    background: var(--ga-panel, #0a0a0c);
    border-top: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    z-index: 90;
    display: flex;
    flex-direction: column;
    animation: seqSlideUp 0.2s ease-out;
  }
  @keyframes seqSlideUp {
    from { transform: translateY(100%); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }

  /* ═══════════════════════════════════
     HEADER
     ═══════════════════════════════════ */
  .seq-header {
    display: flex; align-items: center;
    min-height: 40px;
    padding: 6px 12px; gap: 12px;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    background: var(--ga-bar, #0d0d10); flex-shrink: 0;
  }
  .seq-header-left, .seq-header-center, .seq-header-right {
    display: flex; align-items: center; gap: 6px;
  }
  .seq-header-left { flex: 1; }
  .seq-header-center { flex: 0 0 auto; }
  .seq-header-right { flex: 1; justify-content: flex-end; }
  /* Eyebrow. */
  .seq-title {
    font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; color: var(--ga-ink-2, #888);
    text-transform: uppercase; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); margin-right: 6px;
  }
  .seq-steps-label { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #666); }

  /* ═══════════════════════════════════
     CONTROLS
     ═══════════════════════════════════ */
  .seq-select {
    height: var(--ga-control-h, 26px);
    background: var(--ga-slot, #1a1a1e); border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); color: var(--ga-ink-0, #ccc);
    padding: 0 6px; border-radius: var(--ga-r-hard, 4px); font-size: var(--ga-text-control, 12px); cursor: pointer; font-family: inherit;
  }
  .seq-select:hover { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); }
  .seq-input {
    height: var(--ga-control-h, 26px);
    background: var(--ga-slot, #1a1a1e); border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); color: var(--ga-ink-0, #ccc);
    padding: 0 6px; border-radius: var(--ga-r-hard, 4px); font-size: var(--ga-text-control, 12px); font-family: inherit;
  }
  .seq-input:focus { border-color: var(--ga-focus, #8aa4ff); outline: none; }
  .seq-bpm { width: 50px; text-align: center; font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); }
  .seq-density { width: 60px; padding: 0; height: 16px; accent-color: var(--ga-selection-line, #5278ff); }
  .seq-btn {
    display: flex; align-items: center; justify-content: center;
    width: var(--ga-control-h, 26px); height: var(--ga-control-h, 26px); background: rgba(255, 255, 255, 0.04); border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 4px); color: var(--ga-ink-1, #ccc); cursor: pointer; transition: all 0.15s;
    font-family: inherit; padding: 0;
  }
  .seq-btn:hover { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); color: var(--ga-ink-0, #fff); }
  .seq-play { color: var(--ga-ink-0, #fff); }
  .seq-tap { font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-control, 600); width: auto; padding: 0 8px; }
  .seq-clear { opacity: 0.7; }
  .seq-clear:hover { opacity: 1; }
  .seq-loop-label {
    display: flex; align-items: center; justify-content: center; cursor: pointer;
    width: var(--ga-control-h, 26px); height: var(--ga-control-h, 26px);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); border-radius: var(--ga-r-hard, 4px);
    color: var(--ga-ink-2, #888);
  }
  .seq-loop-label:hover { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); color: var(--ga-ink-0, #fff); }
  .seq-loop-label:has(input:checked) {
    background: var(--ga-selection-bg, #1f3170); border-color: var(--ga-selection-line, #5278ff); color: var(--ga-selection-ink, #e0e8ff);
  }
  .seq-loop-label input { display: none; }
  .seq-step-display {
    font-size: var(--ga-text-control, 12px); color: var(--ga-ink-0, #fff); font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    min-width: 40px; text-align: center; font-weight: 600;
  }
  .seq-step-sep { color: var(--ga-ink-3, #555); }
  .seq-timing-toggle {
    display: flex; height: var(--ga-control-h, 26px); padding: 2px; gap: 2px; box-sizing: border-box;
    background: var(--ga-slot, #060504); border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); border-radius: var(--ga-r-hard, 4px);
  }
  .seq-timing-btn {
    padding: 0 8px; font-size: var(--ga-text-control, 12px); background: transparent; border: none; border-radius: calc(var(--ga-r-hard, 4px) - 1px);
    color: var(--ga-ink-1, #888); cursor: pointer; transition: all 0.15s; font-family: inherit; font-weight: var(--ga-weight-control, 600);
  }
  .seq-timing-btn.active { background: var(--ga-selection-bg, #1f3170); color: var(--ga-selection-ink, #e0e8ff); box-shadow: inset 0 0 0 1px var(--ga-selection-line, #5278ff); }
  .seq-timing-btn:hover:not(.active) { color: var(--ga-ink-0, #fff); }
  .seq-xfade-label {
    display: flex; align-items: center; gap: 6px; font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-control, 600); color: var(--ga-ink-1, #888); cursor: pointer;
  }
  .seq-xfade-label input[type="checkbox"] { accent-color: var(--ga-selection-line, #5278ff); width: 12px; height: 12px; margin: 0; }
  .seq-xfade-dur { width: 56px; }
  .seq-sub { width: 52px; }

  /* ═══════════════════════════════════
     HORIZONTAL GRID
     Rows = layers, Columns = steps
     ═══════════════════════════════════ */
  .seq-grid-container {
    flex: 1; overflow: auto; padding: 4px 8px 8px; position: relative;
  }
  .seq-grid-container::-webkit-scrollbar { width: 6px; height: 6px; }
  .seq-grid-container::-webkit-scrollbar-track { background: transparent; }
  .seq-grid-container::-webkit-scrollbar-thumb { background: var(--ga-line-2, #333); border-radius: 3px; }
  .seq-grid-container::-webkit-scrollbar-thumb:hover { background: var(--ga-line-3, #555); }

  .seq-empty { color: var(--ga-ink-2, #666); font-size: var(--ga-text-meta, 11px); padding: 24px; text-align: center; }

  .seq-grid {
    display: grid;
    gap: 2px;
    width: fit-content;
  }

  /* Top-left corner cell */
  .seq-corner {
    position: sticky; left: 0; top: 0; z-index: 3;
    background: var(--ga-panel, #0a0a0c);
  }

  /* Step number headers (top row) */
  .seq-step-header {
    display: flex; align-items: center; justify-content: center;
    font-size: var(--ga-text-eyebrow, 10px); font-weight: 600; color: var(--ga-ink-2, #555);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    position: sticky; top: 0; z-index: 2;
    background: var(--ga-panel, #0a0a0c);
  }
  .seq-step-header.current {
    color: var(--ga-green, #4CAF50); font-weight: 700;
  }

  /* Layer name labels (left column) */
  .seq-layer-label {
    display: flex; align-items: center; gap: 5px;
    padding: 0 6px;
    font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-1, #aaa);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    position: sticky; left: 0; z-index: 1;
    background: var(--ga-panel, #0a0a0c);
    border-radius: 3px;
  }

  .seq-layer-dot {
    width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  }

  /* Continuous-mode (∞) toggle between the visibility dot and the name. */
  .seq-cont-btn {
    flex-shrink: 0;
    width: 14px; height: 14px;
    padding: 0;
    display: inline-flex; align-items: center; justify-content: center;
    border: 1px solid var(--ga-line-2, rgba(255,255,255,0.12));
    border-radius: 3px;
    background: transparent;
    color: var(--ga-ink-3, #555);
    font-size: var(--ga-text-meta, 11px); line-height: 1;
    cursor: pointer;
    transition: color 0.08s, border-color 0.08s, background 0.08s;
  }
  .seq-cont-btn:hover {
    color: var(--ga-ink-1, #aaa);
    border-color: var(--ga-line-3, rgba(255,255,255,0.24));
  }
  .seq-cont-btn.active {
    color: var(--ga-selection-ink, #e0e8ff);
    border-color: var(--ga-selection-line, #5278ff);
    background: var(--ga-selection-bg, #1f3170);
  }

  .seq-layer-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  /* Continuous rows: blue cells, so alpha-gating rows read apart. */
  .seq-cell.continuous {
    border-color: var(--ga-blue-a16);
  }
  .seq-cell.active.continuous {
    background: var(--ga-blue-300);
    border-color: var(--ga-blue-a45);
    box-shadow: 0 0 4px var(--ga-blue-a28);
  }
  .seq-cell.active.continuous:hover {
    background: var(--ga-blue-300);
  }

  /* ═══════════════════════════════════
     GRID CELLS
     ═══════════════════════════════════ */
  .seq-cell {
    width: 26px; height: 24px;
    border: 1px solid var(--ga-line, rgba(255,255,255,0.07));
    border-radius: 3px;
    background: var(--ga-card, #161618);
    cursor: pointer;
    transition: background 0.06s, border-color 0.06s, box-shadow 0.06s;
    padding: 0;
  }
  .seq-cell:hover {
    border-color: var(--ga-line-3, rgba(255,255,255,0.24));
    background: var(--ga-sub, #1e1e22);
  }
  .seq-cell.active {
    background: var(--ga-coral, #ff6f5e);
    border-color: color-mix(in srgb, var(--ga-coral, #ff6f5e) 50%, transparent);
    box-shadow: 0 0 4px color-mix(in srgb, var(--ga-coral, #ff6f5e) 20%, transparent);
  }
  .seq-cell.active:hover {
    background: color-mix(in srgb, var(--ga-coral, #ff6f5e) 78%, #ffffff);
  }
  /* Current step: the playhead green. */
  .seq-cell.current {
    border-color: color-mix(in srgb, var(--ga-green, #4caf50) 35%, transparent);
    background: color-mix(in srgb, var(--ga-green, #4caf50) 8%, transparent);
  }
  .seq-cell.current.active {
    background: var(--ga-green, #43A047);
    border-color: color-mix(in srgb, var(--ga-green, #4caf50) 60%, transparent);
    box-shadow: 0 0 10px color-mix(in srgb, var(--ga-green, #4caf50) 50%, transparent);
  }
</style>

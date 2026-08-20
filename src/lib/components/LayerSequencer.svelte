<script lang="ts">
  import { t } from '../i18n';
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
    const ids = allLayers.map((l) => l.id);
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
    layerSequencer.updateConfig({ subdivision: parseInt((e.target as HTMLSelectElement).value) as SequencerSubdivision,
    });
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
<button class="seq-toggle" class:open={isOpen} onclick={toggleTray} aria-label={$t('sequencer.layer.toggle')}>
  <span class="toggle-icon">{isOpen ? '\u25BC' : '\u25B2'}</span>
  <span class="toggle-label">{$t('sequencer.layer.toggle')}</span>
</button>

<!-- Slide-up Tray -->
{#if isOpen}
  <div class="seq-tray">
    <!-- Header -->
    <div class="seq-header">
      <div class="seq-header-left">
        <span class="seq-title">{$t('sequencer.layer.title')}</span>
        <select class="seq-select" value={config.presetMode} onchange={onPresetChange}>
          <option value="custom">{$t('sequencer.preset.custom')}</option>
          <option value="snake">{$t('sequencer.preset.snake')}</option>
          <option value="everyOther">{$t('sequencer.preset.everyOther')}</option>
          <option value="random">{$t('sequencer.preset.random')}</option>
        </select>
        {#if config.presetMode === 'random'}
          <input class="seq-input seq-density" type="range" min="0.1" max="0.9" step="0.1"
            value={config.randomDensity} oninput={onRandomDensityChange}
            title={$t('sequencer.layer.densityTitle', { values: { percent: Math.round(config.randomDensity * 100) } })}
          />
        {/if}
        <select class="seq-select" value={stepCount} onchange={onStepCountChange}>
          <option value={4}>4</option>
          <option value={8}>8</option>
          <option value={16}>16</option>
          <option value={32}>32</option>
          <option value={48}>48</option>
        </select>
        <span class="seq-steps-label">{$t('sequencer.steps.label')}</span>
      </div>

      <div class="seq-header-center">
        <button class="seq-btn seq-play" onclick={() => (isPlaying ? layerSequencer.pause() : layerSequencer.play())} title={$t(isPlaying ? 'sequencer.transport.pause' : 'sequencer.transport.play')}
          aria-label={$t(isPlaying ? 'sequencer.transport.pause' : 'sequencer.transport.play')}>
          {#if isPlaying}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
          {/if}
        </button>
        <button class="seq-btn" onclick={() => layerSequencer.stop()} title={$t('sequencer.transport.stop')}
          aria-label={$t('sequencer.transport.stop')}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
        </button>
        <label class="seq-loop-label" title={$t('sequencer.layer.loop')} aria-label={$t('sequencer.layer.loop')}>
          <input type="checkbox" checked={config.loop} onchange={onLoopToggle} />
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
            <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
          </svg>
        </label>
        <button class="seq-btn seq-clear" onclick={() => layerSequencer.clearPattern()} title={$t('sequencer.transport.clear')}
          aria-label={$t('sequencer.transport.clear')}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
        </button>
        <span class="seq-step-display">{currentStep + 1}<span class="seq-step-sep">/</span>{stepCount}</span>
      </div>

      <div class="seq-header-right">
        <div class="seq-timing-toggle">
          <button class="seq-timing-btn" class:active={config.timingMode === 'beat'} onclick={() => onTimingModeChange('beat')}>{$t('sequencer.layer.timing.beat')}</button>
          <button class="seq-timing-btn" class:active={config.timingMode === 'fixed'} onclick={() => onTimingModeChange('fixed')}>{$t('sequencer.layer.timing.fixed')}</button>
        </div>
        {#if config.timingMode === 'beat'}
          <input class="seq-input seq-bpm" type="number" min="30" max="300" value={config.bpm} onchange={onBPMChange} title={$t('sequencer.layer.bpmTitle')}
            aria-label={$t('sequencer.common.bpm')}
          />
          <button class="seq-btn seq-tap" onclick={tapTempo} title={$t('sequencer.layer.tapTempo')}
            aria-label={$t('sequencer.layer.tapTempo')}>{$t('sequencer.layer.tap')}</button>
          <select class="seq-select seq-sub" value={config.subdivision} onchange={onSubdivisionChange}
            title={$t('sequencer.layer.subdivisionTitle')}>
            <option value={1}>1/4</option>
            <option value={2}>1/8</option>
            <option value={4}>1/16</option>
          </select>
        {:else}
          <select class="seq-select" value={config.fixedStepDuration} onchange={onFixedDurationChange}
            title={$t('sequencer.layer.fixedDurationTitle')}
          >
            <option value={0.25}>{$t('sequencer.duration.seconds', { values: { value: '0.25' } })}</option>
            <option value={0.5}>{$t('sequencer.duration.seconds', { values: { value: '0.5' } })}</option>
            <option value={1}>{$t('sequencer.duration.seconds', { values: { value: '1' } })}</option>
            <option value={2}>{$t('sequencer.duration.seconds', { values: { value: '2' } })}</option>
            <option value={5}>{$t('sequencer.duration.seconds', { values: { value: '5' } })}</option>
            <option value={10}>{$t('sequencer.duration.seconds', { values: { value: '10' } })}</option>
          </select>
        {/if}
        <label class="seq-xfade-label" title={$t('sequencer.crossfade.title')}
          aria-label={$t('sequencer.crossfade.title')}
        >
          <input type="checkbox" checked={config.crossfadeEnabled} onchange={onCrossfadeToggle} />
          {$t('sequencer.crossfade.label')}
        </label>
        {#if config.crossfadeEnabled}
          <select class="seq-select seq-xfade-dur" value={config.crossfadeDuration} onchange={onCrossfadeDurationChange}
            title={$t('sequencer.crossfade.durationTitle')}
          >
            <option value={0.1}>{$t('sequencer.duration.seconds', { values: { value: '0.1' } })}</option>
            <option value={0.2}>{$t('sequencer.duration.seconds', { values: { value: '0.2' } })}</option>
            <option value={0.3}>{$t('sequencer.duration.seconds', { values: { value: '0.3' } })}</option>
            <option value={0.5}>{$t('sequencer.duration.seconds', { values: { value: '0.5' } })}</option>
            <option value={1.0}>{$t('sequencer.duration.seconds', { values: { value: '1.0' } })}</option>
            <option value={2.0}>{$t('sequencer.duration.seconds', { values: { value: '2.0' } })}</option>
          </select>
        {/if}
      </div>
    </div>

    <!-- Horizontal Grid: rows = layers, columns = steps -->
    <div class="seq-grid-container">
      {#if allLayers.length === 0}
        <div class="seq-empty">{$t('sequencer.layer.empty')}</div>
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
              <span class="seq-layer-dot" style="background: {layer.visible ? '#FF6B6B' : '#333'}"></span>
              <button
                class="seq-cont-btn"
                class:active={isContinuous}
                onclick={(e) => { e.stopPropagation(); layerSequencer.toggleContinuous(layer.id); }}
                title={$t(isContinuous
                  ? 'sequencer.layer.continuous.onTitle' : 'sequencer.layer.continuous.offTitle')}
                aria-label={$t(
                  isContinuous ? 'sequencer.layer.continuous.onTitle' : 'sequencer.layer.continuous.offTitle',
                )}
                aria-pressed={isContinuous}
              >\u221e</button>
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
                title={$t('sequencer.layer.cellTitle', { values: { name: layer.name, step: stepIdx + 1 } })}
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
    background: linear-gradient(135deg, #0d0d10, #111114);
    border: 1px solid #444;
    color: var(--text-primary, #ddd);
    padding: 8px 16px;
    border-radius: 20px;
    cursor: pointer;
    transition: all 0.2s ease;
    z-index: 100;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
  }
  .seq-toggle:hover { border-color: #ff6b6b; box-shadow: 0 4px 30px rgba(255,107,107,0.2); }
  .seq-toggle.open { border-color: #ff6b6b; background: linear-gradient(135deg, #1a2020, #201515); }
  .toggle-icon { font-size: 11px; color: var(--text-muted, #888); }
  .toggle-label { font-size: 13px; font-weight: 600; }

  /* ═══════════════════════════════════
     TRAY PANEL
     ═══════════════════════════════════ */
  .seq-tray {
    position: fixed;
    bottom: var(--ga-bottom-rail-offset, 74px); left: 0; right: 0;
    height: 280px;
    background: var(--bg-primary, #0a0a0c);
    border-top: 1px solid #333;
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
    padding: 6px 16px; gap: 12px;
    border-bottom: 1px solid #161618;
    background: var(--bg-primary, #0d0d10); flex-shrink: 0;
  }
  .seq-header-left, .seq-header-center, .seq-header-right {
    display: flex; align-items: center; gap: 8px;
  }
  .seq-header-left { flex: 1; }
  .seq-header-center { flex: 0 0 auto; }
  .seq-header-right { flex: 1; justify-content: flex-end; }
  .seq-title { font-size: 12px; font-weight: 700; color: #ff6b6b; letter-spacing: 1px; margin-right: 4px; }
  .seq-steps-label { font-size: 11px; color: #666; }

  /* ═══════════════════════════════════
     CONTROLS
     ═══════════════════════════════════ */
  .seq-select {
    background: var(--bg-tertiary, #1a1a1e); border: 1px solid #333; color: var(--text-primary, #ccc);
    padding: 3px 6px; border-radius: 4px; font-size: 12px; cursor: pointer; font-family: inherit;
  }
  .seq-select:hover { border-color: #ff6b6b; }
  .seq-input {
    background: var(--bg-tertiary, #1a1a1e); border: 1px solid #333; color: var(--text-primary, #ccc);
    padding: 3px 6px; border-radius: 4px; font-size: 12px; font-family: inherit;
  }
  .seq-input:focus { border-color: #ff6b6b; outline: none; }
  .seq-bpm { width: 50px; text-align: center; }
  .seq-density { width: 60px; padding: 0; height: 16px; accent-color: #ff6b6b; }
  .seq-btn {
    display: flex; align-items: center; justify-content: center;
    width: 28px; height: 24px; background: var(--bg-tertiary, #1a1a1e); border: 1px solid #444;
    border-radius: 4px; color: var(--text-primary, #ccc); cursor: pointer; transition: all 0.15s;
    font-family: inherit; padding: 0;
  }
  .seq-btn:hover { background: rgba(255,107,107,0.2); border-color: #ff6b6b; color: #ff6b6b; }
  .seq-play { background: rgba(255,107,107,0.15); border-color: #ff6b6b; color: #ff6b6b; }
  .seq-play:hover { background: rgba(255,107,107,0.35); }
  .seq-tap { font-size: 10px; font-weight: 700; width: auto; padding: 0 8px; letter-spacing: 0.5px; }
  .seq-clear { opacity: 0.6; }
  .seq-clear:hover { opacity: 1; }
  .seq-loop-label { display: flex; align-items: center; gap: 3px; cursor: pointer; color: var(--text-muted, #888); font-size: 12px; }
  .seq-loop-label input { display: none; }
  .seq-loop-label input:checked ~ svg { color: #ff6b6b; }
  .seq-step-display {
    font-size: 13px; color: #ff6b6b; font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    min-width: 40px; text-align: center; font-weight: 700;
  }
  .seq-step-sep { color: #555; }
  .seq-timing-toggle { display: flex; border: 1px solid #333; border-radius: 4px; overflow: hidden; }
  .seq-timing-btn {
    padding: 3px 8px; font-size: 11px; background: var(--bg-tertiary, #1a1a1e); border: none;
    color: var(--text-muted, #888); cursor: pointer; transition: all 0.15s; font-family: inherit; font-weight: 600;
  }
  .seq-timing-btn:first-child { border-right: 1px solid #333; }
  .seq-timing-btn.active { background: rgba(255,107,107,0.2); color: #ff6b6b; }
  .seq-timing-btn:hover:not(.active) { background: #222; color: var(--text-secondary, #aaa); }
  .seq-xfade-label {
    display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-muted, #888); cursor: pointer;
  }
  .seq-xfade-label input[type='checkbox'] { accent-color: #ff6b6b; width: 12px; height: 12px; }
  .seq-xfade-dur { width: 52px; }
  .seq-sub { width: 48px; }

  /* ═══════════════════════════════════
     HORIZONTAL GRID
     Rows = layers, Columns = steps
     ═══════════════════════════════════ */
  .seq-grid-container {
    flex: 1; overflow: auto; padding: 4px 8px 8px; position: relative;
  }
  .seq-grid-container::-webkit-scrollbar { width: 6px; height: 6px; }
  .seq-grid-container::-webkit-scrollbar-track { background: transparent; }
  .seq-grid-container::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
  .seq-grid-container::-webkit-scrollbar-thumb:hover { background: #555; }

  .seq-empty { color: #666; font-size: 13px; padding: 24px; text-align: center; }

  .seq-grid {
    display: grid;
    gap: 2px;
    width: fit-content;
  }

  /* Top-left corner cell */
  .seq-corner {
    position: sticky; left: 0; top: 0; z-index: 3;
    background: var(--bg-primary, #0a0a0c);
  }

  /* Step number headers (top row) */
  .seq-step-header {
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 600; color: #555;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    position: sticky; top: 0; z-index: 2;
    background: var(--bg-primary, #0a0a0c);
  }
  .seq-step-header.current {
    color: #4caf50; font-weight: 700;
  }

  /* Layer name labels (left column) */
  .seq-layer-label {
    display: flex; align-items: center; gap: 5px;
    padding: 0 6px;
    font-size: 11px; color: var(--text-secondary, #aaa);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    position: sticky; left: 0; z-index: 1;
    background: var(--bg-primary, #0a0a0c);
    border-radius: 3px;
  }

  .seq-layer-dot {
    width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  }

  /* Continuous-mode (∞) toggle, lives inside .seq-layer-label between
     the visibility dot and the layer name. Active state mirrors the
     accent used for continuous cells (cyan) so the row visually signals
     "this layer is in continuous mode" at a glance. */
  .seq-cont-btn {
    flex-shrink: 0;
    width: 14px; height: 14px;
    padding: 0;
    display: inline-flex; align-items: center; justify-content: center;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 3px;
    background: transparent;
    color: #555;
    font-size: 11px; line-height: 1;
    cursor: pointer;
    transition: color 0.08s, border-color 0.08s, background 0.08s;
  }
  .seq-cont-btn:hover {
    color: var(--text-secondary, #aaa);
    border-color: rgba(76,209,255,0.4);
  }
  .seq-cont-btn.active {
    color: #4cd1ff;
    border-color: rgba(76,209,255,0.55);
    background: rgba(76,209,255,0.08);
  }

  .seq-layer-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  /* Continuous rows get a faint cyan tint on their cells so the user
     can see at a glance which rows are gating alpha vs. fully gating
     the layer. Keeps the active/current accents distinct. */
  .seq-cell.continuous {
    border-color: rgba(76,209,255,0.18);
  }
  .seq-cell.active.continuous {
    background: #4cd1ff;
    border-color: rgba(76,209,255,0.55);
    box-shadow: 0 0 4px rgba(76,209,255,0.25);
  }
  .seq-cell.active.continuous:hover {
    background: #6fdcff;
  }

  /* ═══════════════════════════════════
     GRID CELLS
     ═══════════════════════════════════ */
  .seq-cell {
    width: 26px; height: 24px;
    border: 1px solid rgba(255,255,255,0.05);
    border-radius: 3px;
    background: var(--bg-tertiary, #161618);
    cursor: pointer;
    transition: background 0.06s, border-color 0.06s, box-shadow 0.06s;
    padding: 0;
  }
  .seq-cell:hover {
    border-color: rgba(255,107,107,0.3);
    background: #1e1e22;
  }
  .seq-cell.active {
    background: #ff6b6b;
    border-color: rgba(255,107,107,0.5);
    box-shadow: 0 0 4px rgba(255,107,107,0.2);
  }
  .seq-cell.active:hover {
    background: #ff8585;
  }
  .seq-cell.current {
    border-color: rgba(76,175,80,0.35);
    background: rgba(76,175,80,0.08);
  }
  .seq-cell.current.active {
    background: #43a047;
    border-color: rgba(76,175,80,0.6);
    box-shadow: 0 0 10px rgba(76,175,80,0.5);
  }
</style>

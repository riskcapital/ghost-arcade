<script lang="ts">
  /**
   * ScreenInspector — bottom half of the Screens left-sidebar panel.
   *
   * Renders editable controls for the currently-selected Screen:
   *   - Identity (name, target type + spout sender name OR display picker)
   *   - Warp mode (rect / corners / mesh) + reset-warp action
   *   - Edge blend per edge + per-edge gamma overrides
   *   - Black-level lift (RGB + feather)
   *   - Color correction (brightness / contrast / gamma)
   *   - Rotation
   *   - Stage effect bind (drives screen brightness from a procedural
   *     stage-effect pattern)
   *   - Per-screen effect chain (Effect[] post-process)
   *
   * All edits go through `screenActions.update(id, partial)` so the
   * settings store is the single mutation point. The Screen Editor
   * canvas overlay (in Canvas.svelte / a sibling component) reads the
   * same store, so warp-handle drags and slider edits both reflect
   * live on the editor canvas.
   */
  import type { OutputSlice } from '../stores/settings';
  import { screenActions } from '../stores/screens';
  import { isDesktopApp, getTextureShareLabel } from '$lib/bridge';

  type DisplayInfo = {
    id: number; label: string; width: number; height: number;
    x: number; y: number; isPrimary: boolean; scaleFactor: number;
  };

  interface Props {
    screen: OutputSlice;
    displays: DisplayInfo[];
    openWindowIds: string[];
    onOpenOnDisplay: (s: OutputSlice) => void;
    onCloseOnDisplay: (s: OutputSlice) => void;
    onRefreshDisplays: () => void;
  }
  let { screen, displays, openWindowIds, onOpenOnDisplay, onCloseOnDisplay, onRefreshDisplays }: Props = $props();

  const tsLabel = getTextureShareLabel();

  function update(partial: Partial<OutputSlice>) {
    screenActions.update(screen.id, partial);
  }

  function clampNumber(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
  }

  function numberFromEvent(e: Event, fallback = 0) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    return Number.isFinite(value) ? value : fallback;
  }

  function updateNumber(key: keyof OutputSlice, value: number, min: number, max: number) {
    update({ [key]: clampNumber(value, min, max) } as Partial<OutputSlice>);
  }

  function updatePercent(key: keyof OutputSlice, value: number, min: number, max: number) {
    updateNumber(key, value / 100, min, max);
  }

  function resetBlend() {
    update({
      edgeBlendLeft: 0,
      edgeBlendRight: 0,
      edgeBlendTop: 0,
      edgeBlendBottom: 0,
      edgeBlendGamma: 2.2,
      edgeBlendLeftGamma: undefined,
      edgeBlendRightGamma: undefined,
      edgeBlendTopGamma: undefined,
      edgeBlendBottomGamma: undefined,
    });
  }

  function setAllBlend(value: number) {
    update({
      edgeBlendLeft: value,
      edgeBlendRight: value,
      edgeBlendTop: value,
      edgeBlendBottom: value,
    });
  }

  function resetBlackLevel() {
    update({
      blackLevelR: 0,
      blackLevelG: 0,
      blackLevelB: 0,
      blackLevelFeather: 0.5,
    });
  }

  function applyColorCorrection(brightness: number, contrast: number, gamma: number) {
    update({ brightness, contrast, gamma });
  }

  const colorPresets = [
    { label: 'Neutral', brightness: 1, contrast: 1, gamma: 1 },
    { label: 'Punch', brightness: 1.05, contrast: 1.12, gamma: 1.05 },
    { label: 'Soft', brightness: 0.96, contrast: 0.92, gamma: 1.18 },
  ];
</script>

<div class="inspector">
  <!-- Identity & target ─────────────────────────────────────────── -->
  <section class="sec">
    <input
      class="name-input"
      value={screen.name}
      onchange={(e) => update({ name: (e.target as HTMLInputElement).value })}
      placeholder="Screen name"
    />

    <label class="field">
      <span class="lbl">Send to</span>
      <select
        value={screen.targetType ?? 'sender'}
        onchange={(e) => {
          const t = (e.target as HTMLSelectElement).value as 'sender' | 'display';
          update({ targetType: t, ...(t === 'sender' ? { displayId: null } : {}) });
        }}
      >
        <option value="sender">{tsLabel} / NDI® sender</option>
        <option value="display" disabled={!isDesktopApp}>Physical display</option>
      </select>
    </label>

    <p class="ndi-attribution">
      <a href="https://ndi.video/" target="_blank" rel="noreferrer">NDI®</a>
      is a registered trademark of Vizrt NDI AB.
    </p>

    {#if (screen.targetType ?? 'sender') === 'display'}
      <label class="field">
        <span class="lbl">Display</span>
        <select
          value={screen.displayId ?? ''}
          onchange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            update({ displayId: v === '' ? null : parseInt(v) });
          }}
        >
          <option value="">— pick —</option>
          {#each displays as d}
            <option value={d.id}>{d.label || `Display ${d.id}`} ({d.width}×{d.height}{d.isPrimary ? ' · primary' : ''})</option>
          {/each}
        </select>
        <button class="icon-btn" title="Refresh display list" onclick={onRefreshDisplays}>↻</button>
      </label>
      {#if screen.displayId != null && displays.find(d => d.id === screen.displayId)?.isPrimary}
        <p class="warn-banner">
          ⚠ This is your primary display. Opening here will cover the editor. Press <kbd>Esc</kbd> in the slice window to close it.
        </p>
      {/if}
      <div class="field">
        <span class="lbl">&nbsp;</span>
        {#if openWindowIds.includes(screen.id)}
          <button class="full-btn danger" onclick={() => onCloseOnDisplay(screen)}>Close on display</button>
        {:else}
          <button class="full-btn" disabled={screen.displayId == null} onclick={() => onOpenOnDisplay(screen)}>Open on display</button>
        {/if}
      </div>
    {:else}
      <label class="field">
        <span class="lbl">Sender</span>
        <input
          type="text"
          value={screen.spoutName}
          oninput={(e) => update({ spoutName: (e.target as HTMLInputElement).value })}
        />
      </label>
    {/if}
  </section>

  <!-- Slice ────────────────────────────────────────────────────────
       Per-Screen geometric warp (corners/mesh) was removed — all
       geometric warping is now done ONCE, globally, by the Master Warp.
       A Screen is simply a rectangular SLICE of that warped total
       output. Set the slice rectangle by dragging on the editor canvas
       or the top-down preview; only orientation lives here. -->
  <section class="sec">
    <h4>Slice</h4>
    <p class="hint">This screen takes a rectangular slice of the total (master-warped) output. Drag its rectangle on the canvas or the preview above to set it.</p>
    <label class="field">
      <span class="lbl">Rotation</span>
      <select value={screen.rotation} onchange={(e) => update({ rotation: parseInt((e.target as HTMLSelectElement).value) as 0 | 90 | 180 | 270 })}>
        <option value={0}>0°</option><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option>
      </select>
    </label>
  </section>

  <!-- Edge blend ───────────────────────────────────────────────── -->
  <section class="sec controls-sec">
    <div class="section-row">
      <h4>Edge Blend</h4>
      <button class="section-action" onclick={resetBlend}>Reset</button>
    </div>
    <div class="preset-strip">
      <button class="chip-btn" onclick={() => setAllBlend(0)}>Clear</button>
      <button class="chip-btn" onclick={() => setAllBlend(0.10)}>All 10%</button>
      <button class="chip-btn" onclick={() => setAllBlend(0.15)}>All 15%</button>
    </div>
    <div class="control-stack">
      <div class="range-row">
        <span class="range-label">Left edge</span>
        <input aria-label="Left edge blend" type="range" min="0" max="0.5" step="0.01" value={screen.edgeBlendLeft}
          oninput={(e) => updateNumber('edgeBlendLeft', numberFromEvent(e), 0, 0.5)} />
        <span class="value-wrap">
          <input class="value-box" aria-label="Left edge blend percent" type="number" min="0" max="50" step="1" value={Math.round(screen.edgeBlendLeft * 100)}
            onchange={(e) => updatePercent('edgeBlendLeft', numberFromEvent(e), 0, 0.5)} />
          <span class="unit">%</span>
        </span>
      </div>
      <div class="range-row">
        <span class="range-label">Right edge</span>
        <input aria-label="Right edge blend" type="range" min="0" max="0.5" step="0.01" value={screen.edgeBlendRight}
          oninput={(e) => updateNumber('edgeBlendRight', numberFromEvent(e), 0, 0.5)} />
        <span class="value-wrap">
          <input class="value-box" aria-label="Right edge blend percent" type="number" min="0" max="50" step="1" value={Math.round(screen.edgeBlendRight * 100)}
            onchange={(e) => updatePercent('edgeBlendRight', numberFromEvent(e), 0, 0.5)} />
          <span class="unit">%</span>
        </span>
      </div>
      <div class="range-row">
        <span class="range-label">Top edge</span>
        <input aria-label="Top edge blend" type="range" min="0" max="0.5" step="0.01" value={screen.edgeBlendTop}
          oninput={(e) => updateNumber('edgeBlendTop', numberFromEvent(e), 0, 0.5)} />
        <span class="value-wrap">
          <input class="value-box" aria-label="Top edge blend percent" type="number" min="0" max="50" step="1" value={Math.round(screen.edgeBlendTop * 100)}
            onchange={(e) => updatePercent('edgeBlendTop', numberFromEvent(e), 0, 0.5)} />
          <span class="unit">%</span>
        </span>
      </div>
      <div class="range-row">
        <span class="range-label">Bottom edge</span>
        <input aria-label="Bottom edge blend" type="range" min="0" max="0.5" step="0.01" value={screen.edgeBlendBottom}
          oninput={(e) => updateNumber('edgeBlendBottom', numberFromEvent(e), 0, 0.5)} />
        <span class="value-wrap">
          <input class="value-box" aria-label="Bottom edge blend percent" type="number" min="0" max="50" step="1" value={Math.round(screen.edgeBlendBottom * 100)}
            onchange={(e) => updatePercent('edgeBlendBottom', numberFromEvent(e), 0, 0.5)} />
          <span class="unit">%</span>
        </span>
      </div>
      <div class="range-row">
        <span class="range-label">Blend curve</span>
        <input aria-label="Edge blend gamma" type="range" min="1" max="4" step="0.1" value={screen.edgeBlendGamma}
          oninput={(e) => updateNumber('edgeBlendGamma', numberFromEvent(e, 2.2), 1, 4)} />
        <span class="value-wrap no-unit">
          <input class="value-box" aria-label="Edge blend gamma value" type="number" min="1" max="4" step="0.1" value={screen.edgeBlendGamma.toFixed(1)}
            onchange={(e) => updateNumber('edgeBlendGamma', numberFromEvent(e, 2.2), 1, 4)} />
        </span>
      </div>
    </div>
  </section>

  <!-- Black level ─────────────────────────────────────────────── -->
  <section class="sec controls-sec">
    <div class="section-row">
      <h4>Black-Level Lift</h4>
      <button class="section-action" onclick={resetBlackLevel}>Reset</button>
    </div>
    <div class="control-stack">
      <div class="range-row">
        <span class="range-label"><span class="swatch red"></span>Red floor</span>
        <input aria-label="Red black-level lift" type="range" min="0" max="0.1" step="0.001" value={screen.blackLevelR ?? 0}
          oninput={(e) => updateNumber('blackLevelR', numberFromEvent(e), 0, 0.1)} />
        <span class="value-wrap">
          <input class="value-box" aria-label="Red black-level lift percent" type="number" min="0" max="10" step="0.1" value={((screen.blackLevelR ?? 0) * 100).toFixed(1)}
            onchange={(e) => updatePercent('blackLevelR', numberFromEvent(e), 0, 0.1)} />
          <span class="unit">%</span>
        </span>
      </div>
      <div class="range-row">
        <span class="range-label"><span class="swatch green"></span>Green floor</span>
        <input aria-label="Green black-level lift" type="range" min="0" max="0.1" step="0.001" value={screen.blackLevelG ?? 0}
          oninput={(e) => updateNumber('blackLevelG', numberFromEvent(e), 0, 0.1)} />
        <span class="value-wrap">
          <input class="value-box" aria-label="Green black-level lift percent" type="number" min="0" max="10" step="0.1" value={((screen.blackLevelG ?? 0) * 100).toFixed(1)}
            onchange={(e) => updatePercent('blackLevelG', numberFromEvent(e), 0, 0.1)} />
          <span class="unit">%</span>
        </span>
      </div>
      <div class="range-row">
        <span class="range-label"><span class="swatch blue"></span>Blue floor</span>
        <input aria-label="Blue black-level lift" type="range" min="0" max="0.1" step="0.001" value={screen.blackLevelB ?? 0}
          oninput={(e) => updateNumber('blackLevelB', numberFromEvent(e), 0, 0.1)} />
        <span class="value-wrap">
          <input class="value-box" aria-label="Blue black-level lift percent" type="number" min="0" max="10" step="0.1" value={((screen.blackLevelB ?? 0) * 100).toFixed(1)}
            onchange={(e) => updatePercent('blackLevelB', numberFromEvent(e), 0, 0.1)} />
          <span class="unit">%</span>
        </span>
      </div>
      <div class="range-row">
        <span class="range-label">Feather</span>
        <input aria-label="Black-level feather" type="range" min="0" max="1" step="0.01" value={screen.blackLevelFeather ?? 0.5}
          oninput={(e) => updateNumber('blackLevelFeather', numberFromEvent(e, 0.5), 0, 1)} />
        <span class="value-wrap">
          <input class="value-box" aria-label="Black-level feather percent" type="number" min="0" max="100" step="1" value={Math.round((screen.blackLevelFeather ?? 0.5) * 100)}
            onchange={(e) => updatePercent('blackLevelFeather', numberFromEvent(e, 50), 0, 1)} />
          <span class="unit">%</span>
        </span>
      </div>
    </div>
  </section>

  <!-- Color correction ─────────────────────────────────────────── -->
  <section class="sec controls-sec color-sec">
    <div class="section-row">
      <h4>Color Correction</h4>
      <button class="section-action" onclick={() => applyColorCorrection(1, 1, 1)}>Reset</button>
    </div>
    <div class="preset-strip">
      {#each colorPresets as preset}
        <button
          class="chip-btn"
          class:active={screen.brightness === preset.brightness && screen.contrast === preset.contrast && screen.gamma === preset.gamma}
          onclick={() => applyColorCorrection(preset.brightness, preset.contrast, preset.gamma)}
        >
          {preset.label}
        </button>
      {/each}
    </div>
    <div class="control-stack">
      <div class="range-row">
        <span class="range-label">Brightness</span>
        <input aria-label="Brightness" type="range" min="0" max="2" step="0.01" value={screen.brightness}
          oninput={(e) => updateNumber('brightness', numberFromEvent(e, 1), 0, 2)} />
        <span class="value-wrap">
          <input class="value-box" aria-label="Brightness percent" type="number" min="0" max="200" step="1" value={(screen.brightness * 100).toFixed(0)}
            onchange={(e) => updatePercent('brightness', numberFromEvent(e, 100), 0, 2)} />
          <span class="unit">%</span>
        </span>
      </div>
      <div class="range-row">
        <span class="range-label">Contrast</span>
        <input aria-label="Contrast" type="range" min="0" max="2" step="0.01" value={screen.contrast}
          oninput={(e) => updateNumber('contrast', numberFromEvent(e, 1), 0, 2)} />
        <span class="value-wrap">
          <input class="value-box" aria-label="Contrast percent" type="number" min="0" max="200" step="1" value={(screen.contrast * 100).toFixed(0)}
            onchange={(e) => updatePercent('contrast', numberFromEvent(e, 100), 0, 2)} />
          <span class="unit">%</span>
        </span>
      </div>
      <div class="range-row">
        <span class="range-label">Gamma</span>
        <input aria-label="Gamma" type="range" min="0.2" max="5" step="0.05" value={screen.gamma}
          oninput={(e) => updateNumber('gamma', numberFromEvent(e, 1), 0.2, 5)} />
        <span class="value-wrap no-unit">
          <input class="value-box" aria-label="Gamma value" type="number" min="0.2" max="5" step="0.05" value={screen.gamma.toFixed(2)}
            onchange={(e) => updateNumber('gamma', numberFromEvent(e, 1), 0.2, 5)} />
        </span>
      </div>
    </div>
  </section>

</div>

<style>
  .inspector {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .sec {
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 6px;
    padding: 10px;
  }
  .sec > h4,
  .section-row h4 {
    margin: 0;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0;
    color: #bdb9c8;
  }
  .sec > h4 {
    margin-bottom: 8px;
  }
  .section-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .section-action {
    padding: 3px 7px;
    background: rgba(255, 255, 255, 0.045);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 4px;
    color: #a9a4b4;
    font-size: 11px;
    font-family: inherit;
    cursor: pointer;
  }
  .section-action:hover {
    background: rgba(187, 134, 252, 0.12);
    border-color: rgba(187, 134, 252, 0.28);
    color: #d8c3ff;
  }
  .name-input {
    width: 100%;
    padding: 7px 9px;
    background: rgba(0, 0, 0, 0.28);
    border: 1px solid rgba(255, 255, 255, 0.11);
    border-radius: 4px;
    color: #f0edf6;
    font-size: 14px;
    margin-bottom: 10px;
    font-family: inherit;
  }
  .name-input:focus,
  .field input:focus,
  .field select:focus,
  .value-box:focus {
    outline: none;
    border-color: rgba(187, 134, 252, 0.55);
    box-shadow: 0 0 0 1px rgba(187, 134, 252, 0.18);
  }
  .field {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 7px;
  }
  .field:last-child { margin-bottom: 0; }
  .field .lbl {
    flex: 0 0 66px;
    color: #918b9b;
    font-size: 12px;
    font-weight: 600;
  }
  .field input[type="text"],
  .field input[type="number"],
  .field select {
    flex: 1;
    min-width: 0;
    padding: 5px 7px;
    background: rgba(0, 0, 0, 0.28);
    border: 1px solid rgba(255, 255, 255, 0.11);
    border-radius: 4px;
    color: #e6e1ee;
    font-size: 12px;
    font-family: inherit;
  }
  .icon-btn {
    background: rgba(255, 255, 255, 0.055);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #c9c3d2;
    cursor: pointer;
    padding: 4px 8px;
    font-size: 13px;
  }
  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.095);
    color: #fff;
  }
  .full-btn {
    flex: 1;
    padding: 6px 8px;
    background: rgba(187, 134, 252, 0.08);
    border: 1px solid rgba(187, 134, 252, 0.25);
    border-radius: 4px;
    color: #BB86FC;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
  }
  .full-btn:hover:not(:disabled) { background: rgba(187, 134, 252, 0.15); }
  .full-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .full-btn.ghost {
    background: transparent;
    color: var(--text-muted, #888);
    border-color: rgba(255, 255, 255, 0.08);
  }
  .full-btn.danger {
    background: rgba(255, 100, 100, 0.08);
    border-color: rgba(255, 100, 100, 0.3);
    color: #ff8080;
  }
  .hint {
    margin: 4px 0 0 0;
    color: #7a7481;
    font-size: 11.5px;
    line-height: 1.4;
  }
  .controls-sec {
    padding: 10px;
  }
  .preset-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-bottom: 9px;
  }
  .chip-btn {
    min-height: 24px;
    padding: 4px 8px;
    background: rgba(255, 255, 255, 0.045);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    color: #b8b2c2;
    font-size: 11px;
    font-family: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .chip-btn:hover,
  .chip-btn.active {
    background: rgba(187, 134, 252, 0.12);
    border-color: rgba(187, 134, 252, 0.32);
    color: #dcc8ff;
  }
  .control-stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .range-row {
    display: grid;
    grid-template-columns: 76px minmax(64px, 1fr) 58px;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .range-label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: #a29baa;
    font-size: 12px;
    font-weight: 650;
    min-width: 0;
    white-space: nowrap;
  }
  .range-row input[type="range"] {
    width: 100%;
    min-width: 0;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--bg-primary, #050507);
    border-radius: 999px;
    accent-color: #BB86FC;
    cursor: pointer;
  }
  .range-row input[type="range"]::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 999px;
    background: linear-gradient(90deg, rgba(187, 134, 252, 0.85), rgba(121, 214, 255, 0.55));
  }
  .range-row input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    margin-top: -4px;
    border-radius: 50%;
    border: 2px solid #111114;
    background: #d7c2ff;
    box-shadow: 0 0 0 1px rgba(187, 134, 252, 0.55);
  }
  .range-row input[type="range"]::-moz-range-track {
    height: 4px;
    border-radius: 999px;
    background: rgba(187, 134, 252, 0.75);
  }
  .range-row input[type="range"]::-moz-range-thumb {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid #111114;
    background: #d7c2ff;
  }
  .value-wrap {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
    min-width: 0;
  }
  .value-wrap.no-unit {
    justify-content: flex-end;
  }
  .value-box {
    width: 43px;
    min-width: 0;
    padding: 3px 4px;
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #e7e1ef;
    font-size: 11.5px;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    text-align: right;
  }
  .no-unit .value-box {
    width: 54px;
  }
  .unit {
    width: 11px;
    color: #77717d;
    font-size: 11px;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
  }
  .swatch {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    display: inline-block;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12);
  }
  .swatch.red { background: #ff6b6b; }
  .swatch.green { background: #77d98b; }
  .swatch.blue { background: #6ba8ff; }
  .warn-banner {
    margin: 6px 0 0 0;
    padding: 6px 8px;
    background: rgba(255, 180, 60, 0.12);
    border: 1px solid rgba(255, 180, 60, 0.35);
    border-radius: 4px;
    color: #ffc875;
    font-size: 12px;
    line-height: 1.4;
  }
  .warn-banner kbd {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 3px;
    padding: 0 5px;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    font-size: 11px;
  }
  .ndi-attribution {
    margin: -2px 0 4px;
    color: #77717d;
    font-size: 11px;
    line-height: 1.35;
  }
  .ndi-attribution a {
    color: #a9d7ff;
    text-decoration: none;
  }
  .ndi-attribution a:hover {
    text-decoration: underline;
  }
</style>

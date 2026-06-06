<script lang="ts">
  /**
   * Clip preview panel — opens from a right-click on a VJ deck cell.
   *
   * Renders the cell's shader (or saved-preset shader) at ~320×180 in a
   * floating sidebar with live parameter controls. Tweaking sliders
   * mutates the underlying clip via vjClipLauncher.updateClipShaderValue
   * — same path the live render uses, so if the clip is already playing
   * the changes also flow to the output instantly.
   *
   * Hits Trigger to launch the clip with the (now-saved) values. ESC or
   * the X button closes the panel.
   *
   * v1 scope: shader / threejs / p5js / jsanimation clip types where
   * shaderInputs are defined. Other clip types open a stripped-down
   * preview (just shows the thumbnail) without param controls.
   */
  import { onMount, onDestroy, tick } from 'svelte';
  import { vjClipLauncher, type VJClip, type VJDeck } from '../stores/vjClipLauncher';
  import { LivePreview } from '../isf/livePreview';
  import { parseISF, type ISFInput } from '../isf/parser';

  export let layerIndex: number;
  export let columnIndex: number;
  export let clip: VJClip;
  // Which deck the right-click came from. Drives where param edits and
  // Trigger writes land so editing a Bank B clip doesn't accidentally
  // mutate Bank A.
  export let bank: VJDeck = 'A';
  export let onClose: () => void;

  let canvas: HTMLCanvasElement | undefined;
  let preview: LivePreview | null = null;

  // shaderInputs come from either the clip's cached field (set when
  // dragged from the library) or by parsing the shaderCode on the fly.
  let shaderInputs: ISFInput[] = [];

  // Local copy of params we render against. Mirrors clip.shaderValues
  // — we update both this and the store on every change.
  let values: Record<string, unknown> = { ...(clip.shaderValues || {}) };

  $: hasShader = !!clip.shaderCode && (clip.type === 'shader' || clip.type === 'threejs' || clip.type === 'p5js');

  onMount(async () => {
    if (hasShader && clip.shaderCode) {
      try {
        const parsed = parseISF(clip.shaderCode);
        shaderInputs = parsed.metadata.INPUTS || [];
      } catch {
        shaderInputs = [];
      }
    }
    await tick();
    if (hasShader && clip.shaderCode && canvas) {
      preview = new LivePreview({
        shaderCode: clip.shaderCode,
        canvas,
        initialValues: values,
      });
    }
    window.addEventListener('keydown', handleKey);
  });

  onDestroy(() => {
    preview?.destroy();
    preview = null;
    window.removeEventListener('keydown', handleKey);
  });

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  function handleValueChange(name: string, value: unknown) {
    values = { ...values, [name]: value };
    preview?.setValue(name, value);
    vjClipLauncher.updateClipShaderValue(layerIndex, columnIndex, name, value, bank);
  }

  function handleColorChange(name: string, hex: string) {
    // Convert "#rrggbb" → [r, g, b, 1.0]
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    handleValueChange(name, [r, g, b, 1.0]);
  }

  function colorToHex(value: unknown): string {
    if (!Array.isArray(value)) return '#ffffff';
    const r = Math.round(Math.max(0, Math.min(1, Number(value[0]) || 0)) * 255);
    const g = Math.round(Math.max(0, Math.min(1, Number(value[1]) || 0)) * 255);
    const b = Math.round(Math.max(0, Math.min(1, Number(value[2]) || 0)) * 255);
    const hex = (n: number) => n.toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }

  function getNumberValue(input: ISFInput): number {
    const v = values[input.NAME];
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return Number(v) || 0;
    if (typeof input.DEFAULT === 'number') return input.DEFAULT;
    return Number(input.MIN ?? 0);
  }

  function getBoolValue(input: ISFInput): boolean {
    const v = values[input.NAME];
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    return !!input.DEFAULT;
  }

  function trigger() {
    vjClipLauncher.triggerClip(layerIndex, columnIndex, bank);
  }

  function resetParam(input: ISFInput) {
    let def: unknown = input.DEFAULT;
    if (def === undefined) {
      if (input.TYPE === 'float' || input.TYPE === 'long') def = input.MIN ?? 0;
      else if (input.TYPE === 'bool') def = false;
      else if (input.TYPE === 'color') def = [1, 1, 1, 1];
      else if (input.TYPE === 'point2D') def = [0.5, 0.5];
    }
    handleValueChange(input.NAME, def);
  }
</script>

<div class="clip-preview-backdrop" on:click={onClose} role="presentation"></div>

<aside class="clip-preview-panel" role="dialog" aria-label="Clip preview">
  <header class="cpp-header">
    <div class="cpp-header-left">
      <div class="cpp-eyebrow">DECK {bank} · L{layerIndex + 1} · C{columnIndex + 1}</div>
      <div class="cpp-title" title={clip.name}>{clip.name || clip.id || 'Untitled clip'}</div>
    </div>
    <button class="cpp-close" type="button" on:click={onClose} aria-label="Close">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  </header>

  <div class="cpp-preview">
    {#if hasShader}
      <canvas bind:this={canvas} width="320" height="180"></canvas>
    {:else if clip.thumbnail}
      <img src={clip.thumbnail} alt={clip.name} />
      <div class="cpp-preview-note">Live preview only available for shader clips</div>
    {:else}
      <div class="cpp-preview-empty">
        <div class="cpp-preview-empty-type">{clip.type}</div>
        <div class="cpp-preview-empty-note">Trigger to view on output</div>
      </div>
    {/if}
  </div>

  {#if hasShader && shaderInputs.length > 0}
    <div class="cpp-params">
      <div class="cpp-section-label">Parameters</div>
      {#each shaderInputs as input (input.NAME)}
        {#if input.TYPE === 'float' || input.TYPE === 'event'}
          {@const min = Number(input.MIN ?? 0)}
          {@const max = Number(input.MAX ?? 1)}
          {@const step = (max - min) / 200}
          {@const cur = getNumberValue(input)}
          <div class="cpp-row">
            <div class="cpp-row-head">
              <label class="cpp-row-label" for="cpp-{input.NAME}">{input.LABEL || input.NAME}</label>
              <button type="button" class="cpp-reset" on:click={() => resetParam(input)} title="Reset to default">↺</button>
              <output class="cpp-value">{cur.toFixed(Math.abs(step) < 0.1 ? 3 : 2)}</output>
            </div>
            <input
              id="cpp-{input.NAME}"
              type="range"
              min={min}
              max={max}
              step={step}
              value={cur}
              on:input={(e) => handleValueChange(input.NAME, Number((e.target as HTMLInputElement).value))}
            />
          </div>
        {:else if input.TYPE === 'bool'}
          <div class="cpp-row cpp-row-bool">
            <label class="cpp-row-label" for="cpp-{input.NAME}">{input.LABEL || input.NAME}</label>
            <input
              id="cpp-{input.NAME}"
              type="checkbox"
              checked={getBoolValue(input)}
              on:change={(e) => handleValueChange(input.NAME, (e.target as HTMLInputElement).checked)}
            />
          </div>
        {:else if input.TYPE === 'long'}
          {@const cur = getNumberValue(input)}
          <div class="cpp-row">
            <div class="cpp-row-head">
              <label class="cpp-row-label" for="cpp-{input.NAME}">{input.LABEL || input.NAME}</label>
              <button type="button" class="cpp-reset" on:click={() => resetParam(input)} title="Reset to default">↺</button>
              <output class="cpp-value">{cur}</output>
            </div>
            <input
              id="cpp-{input.NAME}"
              type="range"
              min={Number(input.MIN ?? 0)}
              max={Number(input.MAX ?? 10)}
              step={1}
              value={cur}
              on:input={(e) => handleValueChange(input.NAME, Math.floor(Number((e.target as HTMLInputElement).value)))}
            />
          </div>
        {:else if input.TYPE === 'color'}
          <div class="cpp-row cpp-row-color">
            <label class="cpp-row-label" for="cpp-{input.NAME}">{input.LABEL || input.NAME}</label>
            <input
              id="cpp-{input.NAME}"
              type="color"
              value={colorToHex(values[input.NAME] ?? input.DEFAULT)}
              on:input={(e) => handleColorChange(input.NAME, (e.target as HTMLInputElement).value)}
            />
          </div>
        {/if}
      {/each}
    </div>
  {:else if hasShader}
    <div class="cpp-params">
      <div class="cpp-section-label">Parameters</div>
      <div class="cpp-empty-params">No exposed parameters on this shader.</div>
    </div>
  {/if}

  <footer class="cpp-footer">
    <button class="cpp-trigger" type="button" on:click={trigger}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
      Trigger
    </button>
    <span class="cpp-hint">Esc to close</span>
  </footer>
</aside>

<style>
  .clip-preview-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(2px);
    z-index: 9990;
    animation: cpp-fade-in 0.2s ease-out;
  }
  @keyframes cpp-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .clip-preview-panel {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 380px;
    max-height: 85vh;
    background: rgba(20, 20, 26, 0.98);
    backdrop-filter: blur(24px);
    border: 1px solid rgba(126, 200, 227, 0.2);
    border-radius: 12px;
    z-index: 9991;
    display: flex;
    flex-direction: column;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 133, 119, 0.05);
    overflow: hidden;
    animation: cpp-pop 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes cpp-pop {
    from { opacity: 0; transform: translate(-50%, -50%) scale(0.94); }
    to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  }

  .cpp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background: linear-gradient(180deg, rgba(255, 133, 119, 0.06), transparent);
    gap: 10px;
  }
  .cpp-header-left { min-width: 0; flex: 1; }
  .cpp-eyebrow {
    font-size: 10px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    color: #7EC8E3;
    letter-spacing: 0.1em;
    margin-bottom: 2px;
  }
  .cpp-title {
    font-size: 14px;
    font-weight: 600;
    color: #fff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cpp-close {
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    background: rgba(255, 255, 255, 0.06);
    border: none;
    border-radius: 50%;
    color: var(--text-secondary, #aaa);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
  }
  .cpp-close:hover { background: rgba(255, 255, 255, 0.12); color: #fff; }

  .cpp-preview {
    padding: 12px 16px;
    background: #000;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 180px;
  }
  .cpp-preview canvas,
  .cpp-preview img {
    width: 320px;
    height: 180px;
    object-fit: cover;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    display: block;
    background: #000;
  }
  .cpp-preview-note {
    margin-left: 12px;
    font-size: 11px;
    color: var(--text-muted, #888);
    max-width: 80px;
    line-height: 1.4;
  }
  .cpp-preview-empty {
    width: 320px;
    height: 180px;
    border: 1px dashed rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    color: #666;
  }
  .cpp-preview-empty-type {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-secondary, #aaa);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .cpp-preview-empty-note {
    font-size: 11px;
    color: #666;
  }

  .cpp-params {
    padding: 12px 16px 14px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }
  .cpp-params::-webkit-scrollbar { width: 6px; }
  .cpp-params::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.08);
    border-radius: 3px;
  }

  .cpp-section-label {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 10px;
    color: var(--text-muted, #888);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    margin-bottom: 10px;
  }

  .cpp-row {
    margin-bottom: 12px;
  }
  .cpp-row:last-child { margin-bottom: 0; }
  .cpp-row-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }
  .cpp-row-label {
    flex: 1;
    font-size: 11px;
    color: #d4d4d4;
    text-transform: capitalize;
  }
  .cpp-reset {
    background: transparent;
    border: none;
    color: #666;
    cursor: pointer;
    font-size: 12px;
    padding: 0 4px;
    line-height: 1;
  }
  .cpp-reset:hover { color: #fff; }
  .cpp-value {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 10px;
    color: #7EC8E3;
    min-width: 36px;
    text-align: right;
  }
  .cpp-row input[type="range"] {
    width: 100%;
    height: 18px;
    background: transparent;
    cursor: pointer;
    accent-color: #FF8577;
  }

  .cpp-row-bool {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }
  .cpp-row-bool .cpp-row-label { margin-bottom: 0; }
  .cpp-row-bool input[type="checkbox"] {
    accent-color: #FF8577;
  }

  .cpp-row-color {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }
  .cpp-row-color .cpp-row-label { margin-bottom: 0; }
  .cpp-row-color input[type="color"] {
    width: 36px;
    height: 22px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    padding: 0;
  }

  .cpp-empty-params {
    font-size: 11px;
    color: #666;
    font-style: italic;
  }

  .cpp-footer {
    padding: 12px 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(0, 0, 0, 0.2);
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .cpp-trigger {
    flex: 1;
    background: linear-gradient(135deg, #FF8577, #7EC8E3);
    color: #0a0a0a;
    border: none;
    border-radius: 6px;
    padding: 10px 16px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: filter 0.15s, transform 0.15s, box-shadow 0.15s;
    box-shadow: 0 4px 12px rgba(255, 133, 119, 0.3);
  }
  .cpp-trigger:hover {
    filter: brightness(1.1);
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(255, 133, 119, 0.45);
  }
  .cpp-trigger:active { transform: translateY(0); }
  .cpp-hint {
    font-size: 10px;
    color: #666;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  }
</style>
